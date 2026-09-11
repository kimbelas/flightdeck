// `WS /pty` — SEC-WS-1, SEC-WS-2, SEC-WS-3.
//
// The handshake is the whole security story, because a WebSocket upgrade is not CORS-protected:
// the browser sends it to any loopback port a hostile page names, and only the server can refuse.
// P0-T7 measured both halves (RESEARCH.md F.4.4) — the upgrade arrives carrying the hostile page's
// real `Origin`, and from the deck's own origin it is accepted. So:
//
//   1. `screenUpgrade` — Host and Origin, before a socket exists at all.
//   2. The bind target is parsed from the URL and frozen. No frame retargets it (SEC-WS-2).
//   3. The first frame must be a valid ticket, within 2 s, or close 1008. Nothing is spawned before
//      it: an unauthenticated socket must never cost a process.
//
// The credential is in a frame rather than a header because a browser cannot set headers on a
// WebSocket handshake — there is nowhere else to put it. It is a **ticket**, not the per-boot
// token: minted by `POST /pty-ticket` for one target, redeemed here once, expired within seconds
// (TicketOffice, DECISIONS.md D32). The token is never accepted here, which is the whole point —
// a first frame carrying it closes 1008 like any other wrong credential.
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  encodeServerFrame,
  parseClientFrame,
  parsePtyTarget,
  type PtyTarget,
  type ServerFrame,
} from '../../contracts/pty-protocol.ts';
import type { PaneRegistry } from '../application/pane-registry.ts';
import type { TicketOffice } from '../application/ticket-office.ts';
import type { Logger } from '../ports/logger.ts';
import type { LoopbackGuard, RequestFacts } from './loopback-guard.ts';

const PTY_PATH = '/pty';
/** SEC-WS-2. */
const MAX_FRAME_BYTES = 1024 * 1024;
const POLICY_VIOLATION = 1008;

const DEFAULT_SIZE = { cols: 80, rows: 24 };

/**
 * The clocks the socket runs on — SEC-WS-1 and SEC-WS-2.
 *
 * Injected rather than fixed so a test can prove the deadline fires without waiting two real
 * seconds for it. A timeout nobody can afford to test is a timeout that silently stops working.
 */
export interface SocketTimings {
  /** How long a socket may stay silent before it must have sent its ticket. */
  readonly authDeadlineMs: number;
  readonly pingIntervalMs: number;
  readonly idleTimeoutMs: number;
}

export const DEFAULT_TIMINGS: SocketTimings = {
  authDeadlineMs: 2000,
  pingIntervalMs: 30_000,
  idleTimeoutMs: 30 * 60_000,
};

/**
 * Everything the socket needs to decide whether a connection may exist.
 *
 * An object rather than four positional arguments: the ticket office joined the list in P5a-T2b,
 * and a constructor where `guard` and `tickets` are both "the thing that says no" is one a call
 * site can get wrong silently. Named fields cannot be transposed.
 */
export interface SocketDependencies {
  readonly guard: LoopbackGuard;
  readonly panes: PaneRegistry;
  readonly tickets: TicketOffice;
  readonly logger: Logger;
}

export class PtySocketServer {
  private readonly guard: LoopbackGuard;
  private readonly panes: PaneRegistry;
  private readonly tickets: TicketOffice;
  private readonly logger: Logger;
  private readonly sockets: WebSocketServer;
  private readonly timings: SocketTimings;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(dependencies: SocketDependencies, timings: SocketTimings = DEFAULT_TIMINGS) {
    this.guard = dependencies.guard;
    this.panes = dependencies.panes;
    this.tickets = dependencies.tickets;
    this.logger = dependencies.logger;
    this.timings = timings;
    // `noServer` so the upgrade is screened before ws ever sees it.
    this.sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets.clients) socket.ping();
    }, timings.pingIntervalMs);
    // A heartbeat must never be the reason the process cannot exit.
    this.heartbeat.unref();
  }

  /** Takes over the server's `upgrade` event. Call once, from the composition root. */
  public attachTo(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const facts: RequestFacts = {
        method: request.method,
        url: request.url,
        headers: request.headers,
      };
      const path = (request.url ?? '').split('?')[0];
      const target = parsePtyTarget(request.url);
      const rejection = this.guard.screenUpgrade(facts);

      if (path !== PTY_PATH || rejection !== undefined || target === undefined) {
        this.logger.warn('upgrade_denied', {
          reason: rejection?.reason ?? (target === undefined ? 'bad target' : 'unknown path'),
        });
        // A refused upgrade gets a bare 400 and no hint about which check failed.
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      this.sockets.handleUpgrade(request, socket, head, (connection) => {
        this.awaitAuth(connection, target);
      });
    });
  }

  public close(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.clients) socket.close();
    this.sockets.close();
  }

  /**
   * Holds the socket until the ticket arrives, and spawns nothing until it does.
   *
   * The deadline is armed before the first message rather than after, so a socket that opens and
   * says nothing is closed on the same clock as one that says the wrong thing.
   *
   * The ticket is redeemed against `target` — the URL's, parsed before this socket existed — so a
   * ticket minted for one pane cannot open another. That is what caps an XSS in the deck at the
   * pane it asked for rather than at everything core can spawn (D32).
   */
  private awaitAuth(connection: WebSocket, target: PtyTarget): void {
    const deadline = setTimeout(() => {
      this.refuse(connection, 'auth timeout');
    }, this.timings.authDeadlineMs);

    connection.once('message', (raw: Buffer) => {
      clearTimeout(deadline);
      const frame = parseClientFrame(raw.toString('utf8'));
      if (frame?.type !== 'auth' || !this.tickets.redeem(frame.ticket.trim(), target)) {
        this.refuse(connection, 'first frame is not a valid ticket');
        return;
      }
      this.bind(connection, target);
    });
  }

  private bind(connection: WebSocket, target: PtyTarget): void {
    const opened = this.panes.open(target, DEFAULT_SIZE);
    if (!opened.ok) {
      send(connection, { type: 'error', reason: opened.error });
      connection.close();
      return;
    }

    const pane = opened.value;
    send(connection, { type: 'ready', pid: pane.process.pid, target });

    let idle = this.armIdleTimer(connection);
    pane.process.onData((data) => {
      send(connection, { type: 'output', data });
    });
    pane.process.onExit((code) => {
      send(connection, { type: 'exit', code });
      connection.close();
    });

    connection.on('message', (raw: Buffer) => {
      clearTimeout(idle);
      idle = this.armIdleTimer(connection);
      const frame = parseClientFrame(raw.toString('utf8'));
      // An unparseable frame is dropped, not answered: replying would tell a prober what parsed.
      if (frame?.type === 'input') pane.process.write(frame.data);
      else if (frame?.type === 'resize') pane.process.resize(frame.cols, frame.rows);
    });

    connection.on('close', () => {
      clearTimeout(idle);
      // Closes the attach, never the session (PaneRegistry, RESEARCH.md F.2.6).
      this.panes.close(pane.id);
    });
  }

  private armIdleTimer(connection: WebSocket): NodeJS.Timeout {
    return setTimeout(() => {
      this.refuse(connection, 'idle');
    }, this.timings.idleTimeoutMs);
  }

  private refuse(connection: WebSocket, reason: string): void {
    this.logger.warn('socket_refused', { reason });
    connection.close(POLICY_VIOLATION, reason);
  }
}

function send(connection: WebSocket, frame: ServerFrame): void {
  if (connection.readyState === connection.OPEN) connection.send(encodeServerFrame(frame));
}

// The real socket, the real guard, the real ticket office, a fake PTY — shared by both `/pty` suites.
//
// It is extracted rather than duplicated because P5a-T2b split the socket's tests in two: the
// handshake credential is now a subject of its own size (`pty-socket-auth.test.ts`), and the
// frames an authorised socket carries are the other (`pty-socket-server.test.ts`). Two copies of
// a harness that binds a port and spawns PTYs is how they quietly stop testing the same server.
//
// Only the PTY is fake. The guard and the office are the production classes: what these suites are
// about is the pair, and an office that always said yes would prove the socket calls something.
import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { UI_ORIGIN } from '../../../contracts/origins.ts';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import { PaneRegistry } from '../../../core/application/pane-registry.ts';
import { TicketOffice } from '../../../core/application/ticket-office.ts';
import { LoopbackGuard } from '../../../core/http/loopback-guard.ts';
import { PtySocketServer } from '../../../core/http/pty-socket-server.ts';
import type { PtyCommands, TerminalSize } from '../../../core/ports/pty-commands.ts';
import type { PtySpec } from '../../../core/ports/pty-host.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakePtyHost } from '../../fakes/fake-pty-host.ts';

export const TOKEN = 'f'.repeat(64);
export const TICKET_TTL_MS = 10_000;
/**
 * Short enough that the deadline tests are fast, long enough that a loaded machine does not make
 * an authorised socket race its own timeout. 60 ms flaked once in a full-suite run.
 */
export const AUTH_DEADLINE_MS = 250;

/** The session member alone, so a test can spread it and change one field. */
type SessionTarget = Extract<PtyTarget, { kind: 'session' }>;

export const SHELL: PtyTarget = { kind: 'shell' };
export const SESSION: SessionTarget = {
  kind: 'session',
  sessionId: '11111111-2222-3333-4444-555555555555',
  subscription: '365',
};
export const SHELL_QUERY = '/pty?shell=1';
export const SESSION_QUERY = '/pty?session=11111111-2222-3333-4444-555555555555&subscription=365';

class AnyCommands implements PtyCommands {
  /** Runs a stub for every target. The argv is WindowsPtyCommands' business, not this file's. */
  public forTarget(target: PtyTarget, size: TerminalSize): PtySpec | undefined {
    return {
      command: 'fake.exe',
      args: target.kind === 'session' ? ['attach', target.sessionId] : [],
      cwd: undefined,
      cols: size.cols,
      rows: size.rows,
      env: {},
    };
  }
}

/** One running `/pty` server on an ephemeral port, with everything a test needs to poke at it. */
export class PtySocketHarness {
  public readonly host = new FakePtyHost();
  public readonly clock = new FakeClock();
  public readonly tickets = new TicketOffice(this.clock, TICKET_TTL_MS);
  public readonly panes: PaneRegistry;
  private readonly server: Server;
  private readonly sockets: PtySocketServer;
  private readonly port: number;

  /**
   * Takes an already-listening server and the port it landed on.
   *
   * The port is a constructor argument rather than something read later because the guard's Host
   * check is an exact `127.0.0.1:<port>` match (SEC-HTTP-1): a guard built before the bind would
   * refuse every upgrade in the suite. `start()` is the only sane way to get here.
   */
  constructor(server: Server, port: number) {
    // A logger that writes nowhere: these suites deliberately provoke every refusal there is.
    const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);
    this.server = server;
    this.port = port;
    this.panes = new PaneRegistry(this.host, new AnyCommands(), silent);
    this.sockets = new PtySocketServer(
      {
        guard: new LoopbackGuard({
          port,
          uiOrigin: UI_ORIGIN,
          token: TOKEN,
          bodyLimitBytes: 1024,
        }),
        panes: this.panes,
        tickets: this.tickets,
        logger: silent,
      },
      { authDeadlineMs: AUTH_DEADLINE_MS, pingIntervalMs: 10_000, idleTimeoutMs: 10_000 },
    );
    this.sockets.attachTo(server);
  }

  public static async start(): Promise<PtySocketHarness> {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return new PtySocketHarness(
      server,
      typeof address === 'object' && address !== null ? address.port : 0,
    );
  }

  public async stop(): Promise<void> {
    this.sockets.close();
    this.panes.closeAll();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  /** `origin: null` opens with no Origin header at all, which is its own SEC-WS-1 case. */
  public open(path: string, origin: string | null = UI_ORIGIN): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${String(this.port)}${path}`, {
      ...(origin === null ? {} : { origin }),
      headers: { host: `127.0.0.1:${String(this.port)}` },
    });
  }

  /** Opens a socket and sends `first` as its first frame, whatever that is. */
  public sending(first: unknown, path: string = SHELL_QUERY): WebSocket {
    const socket = this.open(path);
    socket.on('open', () => {
      socket.send(JSON.stringify(first));
    });
    return socket;
  }

  /** Mints a ticket for the path's target and spends it — exactly what a pane does. */
  public authorised(path: string = SHELL_QUERY): WebSocket {
    const ticket = this.tickets.mint(path === SHELL_QUERY ? SHELL : SESSION);
    return this.sending({ type: 'auth', ticket }, path);
  }
}

/** Resolves with the parsed frames the server sent, once it closes or `until` frames arrive. */
export function collect(socket: WebSocket, until: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const frames: Record<string, unknown>[] = [];
    socket.on('message', (raw: Buffer) => {
      frames.push(JSON.parse(raw.toString('utf8')) as Record<string, unknown>);
      if (frames.length >= until) resolve(frames);
    });
    socket.on('close', () => {
      resolve(frames);
    });
    socket.on('error', reject);
  });
}

export function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.on('close', (code: number) => {
      resolve(code);
    });
    socket.on('error', () => {
      // A refused upgrade surfaces as an error, then a close; the close is what is asserted on.
    });
  });
}

// One pane, one socket, one PTY — the browser half of SEC-WS-1.
//
// The order here is the protocol and is not negotiable: mint a ticket, connect, send the ticket as
// the FIRST frame, and only then treat the socket as usable. Core closes 1008 if anything else
// arrives first, and spawns nothing until a valid ticket lands.
//
// **The page never holds the core token.** It holds a ticket it just minted for this one target,
// which core burns on redemption and expires in seconds (DECISIONS.md D32). Connecting is
// therefore asynchronous where it used to be immediate, and that is the whole cost of the change.
//
// The class owns the socket rather than the component, because a React effect that re-runs is an
// ordinary event and a PTY that respawns because a component re-rendered is not.
//
// **What is left in this file is plumbing.** Every decision a pane makes — whether a keystroke is
// held or dropped, whether an exit is an ending or an eviction, which of two explanations for a
// dead pane wins — is in `pane-status.ts`, which touches no DOM and is unit tested. This file
// holds a `WebSocket`, and a `WebSocket` is the reason it cannot be (P5a-T6a, RESEARCH.md G.29).
import type { ClientFrame, PtyTarget, ServerFrame } from '../../contracts/pty-protocol.ts';
import { CORE_WEBSOCKET } from '../../contracts/origins.ts';
import { requestPaneTicket } from './pane-ticket.ts';
import {
  PaneStatusReporter,
  PendingInput,
  readPaneExit,
  reasonText,
  type PaneStatus,
} from './pane-status.ts';
import type { TerminalPane } from './terminal-pane.ts';

export type { PaneStatus } from './pane-status.ts';

export interface PaneSocketListeners {
  onStatus(status: PaneStatus, detail: string | undefined): void;
}

/** Mirrors core's own cap so an oversize paste fails here, visibly, rather than closing the socket. */
const MAX_INPUT_BYTES = 512 * 1024;

export class PaneSocket {
  private readonly pane: TerminalPane;
  private readonly status: PaneStatusReporter;
  private readonly pending = new PendingInput();
  private socket: WebSocket | undefined;
  private authorised = false;
  /** Set by `close()`. Both "do not open the socket I am waiting for" and P5a-T1's "did I ask?". */
  private abandoned = false;
  /** Kept only so an `exit` can be read against what this pane was attached to. */
  private target: PtyTarget | undefined;

  constructor(pane: TerminalPane, listeners: PaneSocketListeners) {
    this.pane = pane;
    this.status = new PaneStatusReporter((report) => {
      listeners.onStatus(report.status, report.detail);
    });
  }

  /**
   * Mints a ticket for `target`, opens the socket, and spends the ticket on it.
   *
   * Awaits the mint before the socket exists, rather than racing the two: core's 2 s auth deadline
   * starts when the socket opens (SEC-WS-1), so a socket opened first would be spending that
   * budget on a fetch. The input handler is wired before the await so a keystroke during the mint
   * is handled by the same code as one during the handshake — held, and delivered when `ready`
   * lands rather than discarded.
   */
  public async connect(target: PtyTarget): Promise<void> {
    this.target = target;
    this.status.update('connecting');
    this.pane.onInput((data) => {
      this.sendInput(data);
    });

    const ticket = await requestPaneTicket(target);
    // A pane closed while the mint was in flight: the ticket goes unspent and expires on its own.
    if (this.abandoned) return;
    if (ticket === undefined) {
      this.status.finish('refused', 'core would not issue a ticket for this pane');
      return;
    }

    const socket = new WebSocket(`${CORE_WEBSOCKET}/pty?${queryFor(target)}`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      // First frame, before anything else can be sent (SEC-WS-1).
      socket.send(JSON.stringify({ type: 'auth', ticket }));
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      this.receive(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.authorised = false;
      // 1008 is core refusing us, which is a different thing to tell the user than "it ended".
      // Either way `finish` decides whether this is news: the `exit` frame arrives first and says
      // more, and it is the one that can say "evicted".
      if (event.code === 1008) this.status.finish('refused', event.reason);
      else this.status.finish('closed');
    });
    socket.addEventListener('error', () => {
      this.status.finish('refused', 'could not reach core');
    });
  }

  /**
   * Types `text` into the PTY as though it had been typed — the image paste's last step (P5a-T8).
   *
   * Deliberately the same path as a keystroke, cap and pending buffer included, rather than a
   * second way in: an image pasted during the handshake is held and delivered on `ready`, exactly
   * as the first character of a password would be.
   */
  public paste(text: string): void {
    this.sendInput(text);
  }

  /** Refits the terminal and tells the PTY its new size. */
  public resize(): void {
    this.pane.fit();
    const { cols, rows } = this.pane.size();
    this.send({ type: 'resize', cols, rows });
  }

  /** Detaches. Closing a pane never stops the session (RESEARCH.md F.2.6). */
  public close(): void {
    this.abandoned = true;
    this.pending.clear();
    this.socket?.close();
    this.socket = undefined;
    this.authorised = false;
  }

  private sendInput(data: string): void {
    if (data.length > MAX_INPUT_BYTES) {
      this.status.update('live', 'paste too large — it was not sent');
      return;
    }
    if (this.authorised) {
      this.send({ type: 'input', data });
      return;
    }
    if (this.abandoned || this.status.ended) return;
    if (!this.pending.hold(data)) {
      this.status.update('connecting', 'typed too much before the pane was ready — not all sent');
    }
  }

  private send(frame: ClientFrame): void {
    if (!this.authorised || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  private receive(raw: string): void {
    const frame = decode(raw);
    if (frame === undefined) return;
    switch (frame.type) {
      case 'ready':
        this.authorised = true;
        this.status.update('live');
        // The PTY spawned at core's default size; tell it what this pane actually is.
        this.resize();
        // After the resize, not before: what was typed during the handshake should land in a
        // terminal that is already the size it will stay, or a TUI redraws under the keystrokes.
        for (const data of this.pending.take()) this.send({ type: 'input', data });
        break;
      case 'output':
        void this.pane.write(frame.data);
        break;
      case 'exit': {
        const report = readPaneExit(frame.code, this.target, this.abandoned);
        if (report !== undefined) this.status.finish(report.status, report.detail);
        break;
      }
      case 'error':
        this.status.finish('refused', reasonText(frame.reason));
        break;
    }
  }
}

function queryFor(target: PtyTarget): string {
  if (target.kind === 'shell') return 'shell=1';
  return `session=${encodeURIComponent(target.sessionId)}&subscription=${target.subscription}`;
}

function decode(raw: string): ServerFrame | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    return value as ServerFrame;
  } catch {
    return undefined;
  }
}

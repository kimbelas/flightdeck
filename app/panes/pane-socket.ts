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
import type { ClientFrame, PtyTarget, ServerFrame } from '../../contracts/pty-protocol.ts';
import { CORE_WEBSOCKET } from '../../contracts/origins.ts';
import { requestPaneTicket } from './pane-ticket.ts';
import type { TerminalPane } from './terminal-pane.ts';

export type PaneStatus = 'connecting' | 'live' | 'closed' | 'refused';

export interface PaneSocketListeners {
  onStatus(status: PaneStatus, detail: string | undefined): void;
}

/** Mirrors core's own cap so an oversize paste fails here, visibly, rather than closing the socket. */
const MAX_INPUT_BYTES = 512 * 1024;

export class PaneSocket {
  private readonly pane: TerminalPane;
  private readonly listeners: PaneSocketListeners;
  private socket: WebSocket | undefined;
  private authorised = false;
  /** Set by `close()`. A pane torn down mid-mint must not open the socket it was waiting for. */
  private abandoned = false;

  constructor(pane: TerminalPane, listeners: PaneSocketListeners) {
    this.pane = pane;
    this.listeners = listeners;
  }

  /**
   * Mints a ticket for `target`, opens the socket, and spends the ticket on it.
   *
   * Awaits the mint before the socket exists, rather than racing the two: core's 2 s auth deadline
   * starts when the socket opens (SEC-WS-1), so a socket opened first would be spending that
   * budget on a fetch. The input handler is wired before the await so a keystroke during the mint
   * is handled by the same code as one during the handshake — dropped by `send`, not by nobody.
   */
  public async connect(target: PtyTarget): Promise<void> {
    this.listeners.onStatus('connecting', undefined);
    this.pane.onInput((data) => {
      this.sendInput(data);
    });

    const ticket = await requestPaneTicket(target);
    // A pane closed while the mint was in flight: the ticket goes unspent and expires on its own.
    if (this.abandoned) return;
    if (ticket === undefined) {
      this.listeners.onStatus('refused', 'core would not issue a ticket for this pane');
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
      if (event.code === 1008) this.listeners.onStatus('refused', event.reason);
      else this.listeners.onStatus('closed', undefined);
    });
    socket.addEventListener('error', () => {
      this.listeners.onStatus('refused', 'could not reach core');
    });
  }

  /** Refits the terminal and tells the PTY its new size. */
  public resize(): void {
    this.pane.fit();
    const { cols, rows } = this.pane.size();
    this.send({ type: 'resize', cols, rows });
  }

  public close(): void {
    this.abandoned = true;
    this.socket?.close();
    this.socket = undefined;
    this.authorised = false;
  }

  private sendInput(data: string): void {
    if (data.length > MAX_INPUT_BYTES) {
      this.listeners.onStatus('live', 'paste too large — it was not sent');
      return;
    }
    this.send({ type: 'input', data });
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
        this.listeners.onStatus('live', undefined);
        // The PTY spawned at core's default size; tell it what this pane actually is.
        this.resize();
        break;
      case 'output':
        void this.pane.write(frame.data);
        break;
      case 'exit':
        this.listeners.onStatus('closed', `session exited (${String(frame.code)})`);
        break;
      case 'error':
        this.listeners.onStatus('refused', reasonText(frame.reason));
        break;
    }
  }
}

function queryFor(target: PtyTarget): string {
  if (target.kind === 'shell') return 'shell=1';
  return `session=${encodeURIComponent(target.sessionId)}&subscription=${target.subscription}`;
}

/** Core's failure names, as something a person reads on a row. */
function reasonText(reason: string): string {
  if (reason === 'held_elsewhere') return 'Already open in another pane or terminal.';
  if (reason === 'cannot_run') return 'Claude Code was not found on this machine.';
  return reason;
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

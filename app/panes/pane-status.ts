// What a pane is doing, and the three decisions that say so — P5a-T6a.
//
// **Nothing here touches the DOM, and that is the point rather than a happy accident.** `PaneSocket`
// is an adapter: it holds a `WebSocket`, a `MessageEvent` and a `CloseEvent`, so importing it from
// `tests/**` pulls those globals into the project that deliberately has `lib: ["ES2023"]` and no
// DOM (tsconfig.app.json's comment is the rule). Measured: doing that re-resolved `ReadableStream`
// program-wide and made `scripts/sse-probe.ts` fail lint on a `for await` it had always done. The
// decisions a pane makes are worth testing and the socket plumbing around them is not, so the
// decisions live here, where a test can reach them without moving the whole project's type floor.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';

export type PaneStatus = 'connecting' | 'live' | 'closed' | 'refused' | 'evicted';

export interface PaneReport {
  readonly status: PaneStatus;
  readonly detail: string | undefined;
}

/**
 * How much pre-`ready` input is held back, in characters.
 *
 * Deliberately far below core's 512 KiB frame cap: this queue exists for the handful of characters
 * a person types into a pane that looks ready before the handshake has finished, and a bound that
 * generous would make an unauthorised socket a place to park half a megabyte.
 */
export const MAX_PENDING_CHARS = 64 * 1024;

/**
 * The keystrokes typed before a pane was ready to send them.
 *
 * `PaneSocket.send` refuses any frame while the socket is unauthorised, which is SEC-WS-1 and
 * stays. What it must not also do is throw the frame away — and it did, so the first character of
 * the first word typed into a fresh pane went nowhere (RESEARCH.md G.5). This is the difference
 * between a guard and a bin.
 */
export class PendingInput {
  private readonly held: string[] = [];
  private chars = 0;

  public get size(): number {
    return this.chars;
  }

  /** @returns whether it fitted. `false` is a thing the pane says out loud, not a silent drop. */
  public hold(data: string): boolean {
    if (this.chars + data.length > MAX_PENDING_CHARS) return false;
    this.held.push(data);
    this.chars += data.length;
    return true;
  }

  /** Everything held, oldest first, and the queue is empty afterwards. */
  public take(): readonly string[] {
    const held = this.held.splice(0, this.held.length);
    this.chars = 0;
    return held;
  }

  public clear(): void {
    this.held.length = 0;
    this.chars = 0;
  }
}

/**
 * Reports a pane's status, and lets the first terminal one stand.
 *
 * A pane ends twice on the wire: core sends an `exit` frame saying what happened, and then the
 * socket closes. The close carries less — no code, no reason — and arrived last, so it replaced
 * "session exited (0)" with a bare "closed" a fraction of a second later, every time. Whichever
 * explanation gets here first is the one that explains the pane.
 */
export class PaneStatusReporter {
  private readonly listener: (report: PaneReport) => void;
  private finished = false;

  constructor(listener: (report: PaneReport) => void) {
    this.listener = listener;
  }

  public get ended(): boolean {
    return this.finished;
  }

  /** A status the pane can move on from — `connecting`, `live`, and the notices attached to them. */
  public update(status: PaneStatus, detail?: string): void {
    if (this.finished) return;
    this.listener({ status, detail });
  }

  /** A status the pane does not come back from. Only the first one is reported. */
  public finish(status: PaneStatus, detail?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.listener({ status, detail });
  }
}

/**
 * What an exiting PTY means, which depends on what the pane was attached to and who asked.
 *
 * A shell that exits has ended — that is what typing `exit` does. An ATTACHED SESSION that exits
 * cleanly with nobody having closed the pane has almost certainly been taken: `claude attach` never
 * refuses a second attach, it evicts the first, and the evicted side exits 0 (RESEARCH.md F.2.6).
 * Nothing on the wire tells the two apart, so the question is answered on this side — the pane that
 * was closed on purpose is the one that asked.
 *
 * @param asked whether this side initiated the detach, which is P5a-T1's owed "did I ask?" flag.
 */
export function readPaneExit(
  code: number,
  target: PtyTarget | undefined,
  asked: boolean,
): PaneReport | undefined {
  // Nothing to report: the pane is being torn down and its card is going with it.
  if (asked) return undefined;
  if (code === 0 && target?.kind === 'session') {
    return {
      status: 'evicted',
      detail: 'Another terminal attached to this session. Reattach to take it back.',
    };
  }
  return { status: 'closed', detail: `session exited (${String(code)})` };
}

/** Core's failure names, as something a person reads on a pane. */
export function reasonText(reason: string): string {
  if (reason === 'held_elsewhere') return 'Already open in another pane or terminal.';
  if (reason === 'cannot_run') return 'Claude Code was not found on this machine.';
  return reason;
}

/** The statuses a pane does not come back from on its own, and so the ones `reattach` is for. */
export const ENDED_STATUSES: ReadonlySet<PaneStatus> = new Set<PaneStatus>([
  'closed',
  'refused',
  'evicted',
]);

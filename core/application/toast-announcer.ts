// Which of the things that happen are worth interrupting the owner for — P6-T3, SPEC §5.5, D16.
//
// It subscribes to the same hub the browser does and raises a Windows toast with no browser
// needed, which is the whole reason core is a separate process (D2, SPEC §11(3)). Three kinds,
// exactly the three D16 named: **needs-you**, **completed**, **errored**.
//
// **Every rule here is an EDGE, not a state**, and that is the difference between a feature and a
// machine that beeps. A sweep runs every ten seconds and re-observes the same blocked session
// every time; a toast per observation would be six an hour per waiting session. So each session's
// last toastable condition is remembered and a toast fires only when it MOVES.
//
// **A first observation never toasts, and this is the trap the rule exists for.** The reconciler
// publishes `seen` for every session it finds, and on boot that is all of them — so a core
// restarted while three sessions sat blocked would open with three toasts about nothing that just
// happened. `seen` sets the baseline and is silent; only `changed` can raise anything.
//
// **`gone` is not a completion.** It means a session left `agents --json --all` entirely, which is
// a record being deleted rather than work finishing (F.2.2). It forgets the session and says
// nothing.
//
// **Interactive sessions never toast, and no code here says so.** They carry no `state` at all
// (contracts/session.ts), so `runState` is undefined and no rule below can match — which is the
// right answer for a different reason than the rules: an interactive session is bound to a
// terminal the owner is looking at.
//
// **One thing this cannot yet tell apart, said out loud.** A daemon-retired session and a finished
// one both read `state: done`, and only `daemon.log` separates them (F.2.3, P7-T4). So an idle
// retirement raises the "finished" toast. That is a wrong word rather than a wrong toast — the
// session did stop — and inventing a heuristic to guess which it was would be worse than the word.
import { needsAttention, parseSessionRow, sessionKey } from '../../contracts/session-row.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { Logger } from '../ports/logger.ts';
import type { Notifier } from '../ports/notifier.ts';
import type { EventFeed } from './event-hub.ts';
import type { MuteBook } from './mute-book.ts';

/** The three D16 named. Closed, because a fourth is a decision and not a new hook name. */
export type ToastKind = 'needs-you' | 'completed' | 'errored';

/** What each kind says. The title is bold in a Windows toast; the body carries the session. */
const TITLES: Readonly<Record<ToastKind, string>> = {
  'needs-you': 'Claude needs you',
  completed: 'Session finished',
  errored: 'Session failed',
};

/**
 * What a body may contain.
 *
 * A session name is the owner's own text and can be a prompt fragment, so it is capped and stripped
 * of control characters before it reaches an argv — `titleOf` in `windows-terminal-commands.ts` for
 * the same reason. Not because the Windows path is a shell: `toasted-notifier` reaches ntfyToast
 * through `execFile`, so each value is one argument. It is the LINUX path in that library that
 * builds a shell string, which is one of the two reasons the adapter refuses to run off Windows.
 */
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const MAX_BODY_CHARS = 120;

export interface ToastAnnouncerParts {
  readonly feed: EventFeed;
  readonly notifier: Notifier;
  readonly mutes: MuteBook;
  readonly logger: Logger;
}

export class ToastAnnouncer {
  private readonly parts: ToastAnnouncerParts;
  /** Keyed by `sessionKey`. The last toastable condition seen, so a toast can be an edge. */
  private readonly condition = new Map<string, ToastKind | undefined>();
  private listening: Cancellation | undefined;

  constructor(parts: ToastAnnouncerParts) {
    this.parts = parts;
  }

  /** Idempotent, like every other `start` here — starting twice must not double the listener. */
  public start(): void {
    if (this.listening !== undefined) return;
    this.listening = this.parts.feed.subscribe((event) => {
      this.consider(event);
    });
  }

  /** Idempotent. */
  public stop(): void {
    this.listening?.cancel();
    this.listening = undefined;
  }

  /**
   * @throws never — `EventHub` counts a listener that throws and carries on, but a toast that took
   * an event away from the store and the browser would be the tail wagging the dog.
   */
  private consider(event: DraftEvent): void {
    try {
      this.decide(event);
    } catch {
      this.parts.logger.warn('toast_failed', { type: event.type });
    }
  }

  private decide(event: DraftEvent): void {
    if (event.source !== 'reconcile') return;
    const row = parseSessionRow(event.payload);
    if (row === undefined) return;
    const key = sessionKey(row);
    if (event.type === 'gone') {
      this.condition.delete(key);
      return;
    }
    const kind = kindOf(row);
    const previous = this.condition.get(key);
    const known = this.condition.has(key);
    this.condition.set(key, kind);
    // `seen` sets the baseline and says nothing; an unchanged condition is not an edge.
    if (event.type !== 'changed' || !known) return;
    if (kind === undefined || kind === previous) return;
    this.raise(kind, row);
  }

  /**
   * Raises it, and leaves a line saying so.
   *
   * The line rather than a counter, and for the reason `LoggingEventSink` is one of four listeners
   * on the same hub: what an operator asking "why did nothing toast" needs is WHICH edge fired and
   * when, not how many did. It is also the only record that survives the toast, which lives for
   * six seconds and then belongs to the Action Center.
   */
  private raise(kind: ToastKind, row: SessionRow): void {
    if (this.parts.mutes.isMuted(row)) return;
    this.parts.notifier.notify({
      title: TITLES[kind],
      body: bodyOf(row),
      sessionId: row.sessionId,
    });
    // No name and no body: a session name is the owner's own text and the log is a file on disk
    // that a fixture capture and a bug report both end up reading (SEC-DATA-2).
    this.parts.logger.info('toast_raised', { kind, subscription: row.subscription });
  }
}

/**
 * The one rule, in the order the flags are ranked (`deriveFlags`).
 *
 * `errored` first, because a session that failed is not one that finished even though both stopped
 * running. `needs-you` is `needsAttention`, exported from `contracts/session-row.ts` so that what
 * toasts and what sorts to the top of the deck are the same sentence (G.24).
 */
function kindOf(row: SessionRow): ToastKind | undefined {
  if (row.runState === 'failed') return 'errored';
  if (needsAttention(row)) return 'needs-you';
  if (!row.live && row.runState === 'done') return 'completed';
  return undefined;
}

/** The session, as a person would name it: its name if it has one, its short id if not. */
function bodyOf(row: SessionRow): string {
  const named = (row.name ?? '').replaceAll(CONTROL_CHARACTERS, ' ').trim();
  return (named === '' ? row.shortId : named).slice(0, MAX_BODY_CHARS);
}

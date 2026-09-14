// One row's presentation, decided outside React — CODING-STANDARDS §3.
//
// Components render these fields. Nothing below needs a DOM to test, which is the point: "is this
// row attachable, and what should it say if not" is the deck's most important question and it
// should not require rendering a page to answer.
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';

export type RowTone = 'needs-you' | 'working' | 'idle' | 'ended';

export class SessionRowViewModel {
  private readonly row: SessionRow;

  constructor(row: SessionRow) {
    this.row = row;
  }

  public get key(): string {
    return `${this.row.subscription}:${this.row.sessionId}`;
  }

  public get title(): string {
    return this.row.name ?? this.row.shortId;
  }

  public get subscriptionLabel(): string {
    return this.row.subscription === '365' ? '365' : 'isg';
  }

  /** The trailing path segment. A full cwd is unreadable in a dense row and rarely what is wanted. */
  public get project(): string {
    const parts = this.row.cwd.split(/[\\/]/).filter((part) => part !== '');
    return parts.at(-1) ?? '—';
  }

  public get kindLabel(): string {
    return this.row.kind;
  }

  public get stateLabel(): string {
    if (!this.row.live) return this.row.runState ?? 'not running';
    return this.row.runState ?? this.row.status ?? 'running';
  }

  /**
   * The one signal the listing carries that means "needs you" (D29).
   *
   * `blocked` only — `waitingFor` does not exist on any record, and `status` is absent often
   * enough that nothing may key off it alone.
   */
  public get tone(): RowTone {
    if (!this.row.live) return 'ended';
    if (this.row.runState === 'blocked') return 'needs-you';
    if (this.row.runState === 'working' || this.row.status === 'busy') return 'working';
    return 'idle';
  }

  public get canOpenPane(): boolean {
    return this.row.attachable;
  }

  /** Why the pane button is absent. Shown, not hidden — the reason is the product (SPEC §5.2). */
  public get blockedReason(): string | undefined {
    return this.row.notAttachableBecause;
  }

  /**
   * Which session to ask about when this row is expanded — P2-T4.
   *
   * `shortId` is sent rather than derived from `sessionId`, even though it is the first block of
   * it: that equality is an observation about how Claude Code names job directories today
   * (RESEARCH.md F.7.1), and the row already carries the real value. Deriving it here would be the
   * deck guessing at a filename.
   */
  public get ref(): SessionRef {
    return {
      sessionId: this.row.sessionId,
      shortId: this.row.shortId,
      subscription: this.row.subscription,
    };
  }

  public get target(): PtyTarget {
    return {
      kind: 'session',
      sessionId: this.row.sessionId,
      subscription: this.row.subscription,
    };
  }

  /**
   * Whether `/`'s filter keeps this row — P2-T5.
   *
   * Matched against what the row actually shows plus the short id, so what someone reads off the
   * screen is what they can type back in. Every term has to land, which is what makes `365 deck`
   * narrow rather than widen; an empty query keeps everything.
   *
   * The short id is in the haystack and the full session id is not. The full one is a UUID nobody
   * types, and including it would let a three-character query match rows whose visible text has
   * nothing to do with it — a filter appearing to keep the wrong sessions.
   */
  public matches(query: string): boolean {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term !== '');
    if (terms.length === 0) return true;
    const haystack = [
      this.title,
      this.row.shortId,
      this.subscriptionLabel,
      this.project,
      this.kindLabel,
      this.stateLabel,
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  public startedAgo(now: number): string {
    const seconds = Math.max(0, Math.round((now - this.row.startedAt) / 1000));
    if (seconds < 60) return `${String(seconds)}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${String(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    return `${String(hours)}h ${String(minutes % 60)}m`;
  }
}

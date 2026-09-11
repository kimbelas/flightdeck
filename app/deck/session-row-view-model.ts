// One row's presentation, decided outside React — CODING-STANDARDS §3.
//
// Components render these fields. Nothing below needs a DOM to test, which is the point: "is this
// row attachable, and what should it say if not" is the deck's most important question and it
// should not require rendering a page to answer.
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

  public get target(): PtyTarget {
    return {
      kind: 'session',
      sessionId: this.row.sessionId,
      subscription: this.row.subscription,
    };
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

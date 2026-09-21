// One row's presentation, decided outside React — CODING-STANDARDS §3.
//
// Components render these fields. Nothing below needs a DOM to test, which is the point: "is this
// row attachable, and what should it say if not" is the deck's most important question and it
// should not require rendering a page to answer.
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import { sharedCwdWarning, sharesCwd } from '../../contracts/duplicate-cwd.ts';

export type RowTone = 'needs-you' | 'working' | 'idle' | 'ended';

export class SessionRowViewModel {
  private readonly row: SessionRow;
  private readonly duplicates: ReadonlySet<string>;

  /**
   * @param duplicates the folders with a live session on BOTH subscriptions (P6-T5), which is the
   * one thing about a row that is not a fact about the row. It is passed in rather than computed
   * because it is a property of the SET, and defaulted to empty so that a caller with one row in
   * its hand — every test in this file — does not have to say "and nothing is shared".
   */
  constructor(row: SessionRow, duplicates: ReadonlySet<string> = new Set()) {
    this.row = row;
    this.duplicates = duplicates;
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

  /**
   * The whole folder, for the one caller that needs a path rather than a label — P6-T2.
   *
   * `project` above is the trailing segment, which is what a dense row can show. A pop-out has to
   * tell Windows Terminal where to open, and a trailing segment would put the tab in a folder of
   * that name under wherever it happened to start. Empty when the row carries none, which the
   * store turns into `undefined` rather than sending an empty string.
   */
  public get cwd(): string | undefined {
    return this.row.cwd === '' ? undefined : this.row.cwd;
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
   * Whether this row can be woken — P4-T2a.
   *
   * A BACKGROUND session that is not live, and nothing else. An interactive session is not a
   * `--bg` job and never becomes one, so offering it here would be offering the one thing
   * SPEC §5.2 says is permanently impossible; and a live session needs no waking. This is the
   * other half of `canOpenPane`: between them, every row that says "not running" now has a button,
   * and the rows that say "already bound to its own terminal" still, correctly, do not.
   */
  public get canResume(): boolean {
    return this.row.kind === 'background' && !this.row.live;
  }

  /**
   * Whether this row can be stopped — P4-T2b, and the exact complement of `canResume`.
   *
   * A running background session, and nothing else. An interactive session is not a `--bg` job and
   * is not core's to stop; a session already stopped has nothing to do. Between this and
   * `canResume` every background row has exactly one lifecycle button, which is what makes the
   * pair readable: the row always offers the thing it is not currently doing.
   */
  public get canStop(): boolean {
    return this.row.kind === 'background' && this.row.live;
  }

  /**
   * Whether this row can be RESPAWNED — P5a-T6.
   *
   * Any background session, running or not, which makes it wider than `canStop` on purpose:
   * `respawn --all` skips one that has finished, and respawning that same session BY NAME works
   * (RESEARCH.md F.10.4). An interactive session is not a `--bg` job and is not core's to restart.
   */
  public get canRespawn(): boolean {
    return this.row.kind === 'background';
  }

  /**
   * Whether this row can be DELETED — P4-T2.
   *
   * Every background session, live or not, which is the one place this family of getters is not
   * the complement of another. `rm` deletes a live session as readily as a stopped one (F.2.8) —
   * that is the measurement the confirm step exists for, not a reason to hide the verb on a row
   * where it works. An interactive session is not a `--bg` job and is not core's to delete.
   */
  public get canRemove(): boolean {
    return this.row.kind === 'background';
  }

  /**
   * What deleting this row would actually cost, in a sentence.
   *
   * Two sentences rather than one, because the two cases are different sizes: a stopped session
   * loses a conversation, and a live one loses a conversation AND is ended mid-turn. A confirm
   * that said the same thing about both would be a confirm nobody reads the second time.
   */
  public get removeWarning(): string {
    const ending = this.row.live ? 'It is running — this ends it, and the' : 'The';
    return `${ending} conversation is deleted. There is no resume.`;
  }

  /**
   * Whether another account has a live session in this same folder — P6-T5, SPEC §5.6.
   *
   * Nothing else on the machine can see this: `claude agents` reads one config directory, so each
   * account's listing shows its own session in the folder and neither mentions the other.
   */
  public get sharesWorkingTree(): boolean {
    return sharesCwd(this.row, this.duplicates);
  }

  /** What to say about it, or `undefined` when there is nothing to say. */
  public get sharedTreeWarning(): string | undefined {
    return this.sharesWorkingTree ? sharedCwdWarning(this.row) : undefined;
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

// How each background session ended, as `daemon.log` tells it, kept for the rows — D62.
//
// `claude agents --json --all` reads `state: done` for a session that was stopped, one that
// finished and one the daemon retired (F.2.3); a retirement taken while the session was blocked
// even keeps `state: blocked` with no `pid` (F.2.15). The log is the only witness, and
// `DaemonReader` already reads its tail for the panel (P7-T4). This is the reconciler's use of the
// same port and the same parse: it names the ending on the ROW, which is what the toast reads.
//
// **Cheap by construction, and the rules are what make it cheap.** The log is read inside the
// reconciler's existing sweep — no timer of its own — and only for a subscription whose sweep holds
// a stopped background session with no ending yet. An ending, once found, is kept until the
// session runs again. One that is not found is looked for on at most `MAX_LOOKUPS` sweeps and then
// left `unknown`: `--all` keeps a background session listed forever, and one whose ending scrolled
// out of the 64 KiB window weeks ago would otherwise cost a read every ten seconds for ever.
//
// **An ending must be newer than the last time the session was seen running.** A session resumed
// by its full uuid, or respawned, keeps its id (F.2.7), so the log can hold an ending from an
// EARLIER run; the sweep that sees it
// stop again can land before its new `bg settled` is written. Without the date check that sweep
// would hand the new stop the old retirement.
import { parseDaemonLog } from '../../contracts/daemon-log.ts';
import type { DaemonEnding } from '../../contracts/daemon-report.ts';
import { sessionKey, type SessionRow } from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { DaemonHistory } from '../domain/daemon-history.ts';
import type { DaemonLogSource } from '../ports/daemon-log-source.ts';
import { withEnding } from './session-rows.ts';

/**
 * Sweeps on which one stopped session's ending is looked for before it is left `unknown`.
 *
 * Three: the reason's line is written before the session stops (F.2.15), so the first look almost
 * always finds it, and thirty seconds is far longer than any gap between a `bg retire` and the
 * listing catching up.
 */
export const MAX_LOOKUPS = 3;

/** A log source with nothing in it, for a reconciler built without one. */
const NO_LOG: DaemonLogSource = { tail: () => Promise.resolve(undefined) };

export class EndingBook {
  private readonly log: DaemonLogSource;
  /** By `sessionKey`: the ending found for the session's current stop. */
  private readonly known = new Map<string, DaemonEnding>();
  private readonly lookups = new Map<string, number>();
  /** By `sessionKey`: the sweep instant the session was last seen running. */
  private readonly liveAt = new Map<string, number>();

  constructor(log: DaemonLogSource = NO_LOG) {
    this.log = log;
  }

  /**
   * Folds in one sweep's rows, reading the log for a subscription only if one of them needs it.
   *
   * @param at the sweep's instant, the same clock the log's instants are compared against.
   * @throws never — the port answers `undefined` for a log it cannot read, and the parse is total.
   */
  public async learn(rows: readonly SessionRow[], at: number): Promise<void> {
    const wanted = new Map<SubscriptionId, SessionRow[]>();
    for (const row of rows) {
      if (row.kind === 'background' && row.live) this.sawRunning(row, at);
      else if (this.wants(row))
        wanted.set(row.subscription, [...(wanted.get(row.subscription) ?? []), row]);
    }
    await Promise.all([...wanted].map(([subscription, list]) => this.lookUp(subscription, list)));
  }

  /** The row with its ending, when one is known and the row is a stopped background session. */
  public explain(row: SessionRow): SessionRow {
    const ending = explainable(row) ? this.known.get(sessionKey(row)) : undefined;
    return ending === undefined ? row : withEnding(row, ending);
  }

  /** The session left the listing (an `rm`). Nothing about it is worth keeping. */
  public forget(row: SessionRow): void {
    const key = sessionKey(row);
    this.known.delete(key);
    this.lookups.delete(key);
    this.liveAt.delete(key);
  }

  /** Running again: whatever ended it last time is about a run that is over. */
  private sawRunning(row: SessionRow, at: number): void {
    const key = sessionKey(row);
    this.known.delete(key);
    this.lookups.delete(key);
    this.liveAt.set(key, at);
  }

  /** Whether this row is worth a read, counting the look if so. */
  private wants(row: SessionRow): boolean {
    if (!explainable(row)) return false;
    const key = sessionKey(row);
    if (this.known.has(key)) return false;
    const tried = this.lookups.get(key) ?? 0;
    if (tried >= MAX_LOOKUPS) return false;
    this.lookups.set(key, tried + 1);
    return true;
  }

  private async lookUp(subscription: SubscriptionId, rows: readonly SessionRow[]): Promise<void> {
    const text = await this.log.tail(subscription);
    if (text === undefined) return;
    const history = DaemonHistory.of(parseDaemonLog(text));
    for (const row of rows) {
      const key = sessionKey(row);
      const ending = history.latestEndingFor(row.shortId);
      if (ending === undefined || ending.at < (this.liveAt.get(key) ?? 0)) continue;
      this.known.set(key, ending);
    }
  }
}

/**
 * A background session the listing says has stopped: no `pid`, and a state that is not `working`.
 *
 * `working` without a `pid` is a session a moment from starting, not one that stopped (G.2) — a
 * respawn looks exactly like that for a sweep, and handing it the ending of the run before would
 * be the date check's bug by another route. `failed` is the listing's own answer and outranks the
 * log's.
 */
function explainable(row: SessionRow): boolean {
  if (row.kind !== 'background' || row.live) return false;
  return row.runState === 'done' || row.runState === 'blocked';
}

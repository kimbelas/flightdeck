// Which transcripts exist — P7-T1, SEC-FS-1.
//
// **The one place in core that WALKS for transcripts rather than being told about them.** Feed 4
// learns which files to tail by listening — a hook payload and a statusLine render each carry a
// `transcript_path` — and its header says why: there are 374 transcripts and 1.2 GB of them on
// this machine, and the ones worth tailing are the ones a session is writing right now.
//
// Search is the opposite question. *"Where did I do that Cloudflare Workers deploy?"* is asked
// about work that finished weeks ago, in a session nobody has posted a hook about since, and a
// feed that only ever saw live files would index the present and call it history. So this walks,
// once at boot and then on a slow timer, and the byte cursors are what make the walk cheap after
// the first pass.
//
// **The directories are derived from the subscription, never taken from a caller** — the rule
// `ClaudeInstall.watchTargets` already follows (SEC-FS-1). The adapter is handed the install and
// asks it for the config directories; nothing outside chooses which folders core reads.
import type { SubscriptionId } from '../../contracts/session.ts';

/** One transcript on disk, as a walk found it. */
export interface CatalogueEntry {
  /** The full path. Never displayed and never logged — it carries the Windows account name. */
  readonly path: string;
  readonly subscription: SubscriptionId;
  /**
   * The session the transcript belongs to — the filename without `.jsonl`.
   *
   * Claude Code names a transcript after the session uuid, which is what makes a search hit
   * clickable without opening the file. A filename that is not a uuid is not a transcript this
   * build understands and the adapter leaves it out rather than inventing an id for it.
   */
  readonly sessionId: string;
  /** The slug folder it sits in — `C--Users-…-flightdeck`. P7-T2's project filter. */
  readonly projectKey: string;
  /** Size now. The indexer skips a file no longer than the cursor it already holds. */
  readonly bytes: number;
}

export interface TranscriptCatalogue {
  /**
   * Every transcript under both subscriptions, newest-written first.
   *
   * Newest first because that is the order somebody wants an index built in: a fresh store catches
   * up on this week before it catches up on March, so search works during the first pass rather
   * than after it.
   *
   * @throws never. A config directory that is not there yet, or that cannot be read, contributes
   * nothing — an absent `.claude-isg` is an ordinary state on a machine with one subscription.
   */
  list(): Promise<readonly CatalogueEntry[]>;
}

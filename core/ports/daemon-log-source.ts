// The end of one subscription's `daemon.log` — P7-T4, RESEARCH.md B.3, SEC-FS-1.
//
// `RosterSource`'s sibling, and shaped like it for its reason: it takes a `SubscriptionId` and
// never a path, so nothing outside the adapter chooses which file is opened. It hands back TEXT
// rather than parsed events because the parse is a pure function over a string
// (contracts/daemon-log.ts) that the fixture tests share, and a fake that took events would be a
// second opinion about what a line means.
import type { SubscriptionId } from '../../contracts/session.ts';

export interface DaemonLogSource {
  /**
   * The last stretch of the log, starting at a line boundary, or `undefined` when there is no log
   * to read — a subscription that has never run a `--bg` session has none, and that is ordinary.
   *
   * @throws never — absent, refused and unreadable are all `undefined`.
   */
  tail(subscription: SubscriptionId): Promise<string | undefined>;
}

// What the background daemon says it is running — `daemon/roster.json`, narrowed (P1-T14).
//
// A port because the interesting half is not the file read, it is the two questions the answer is
// for, and both belong to later tasks: P7-T4 needs "is the supervisor this roster names still
// alive?" (RESEARCH.md F.2.16 — a roster naming a dead `supervisorPid` is the state where `stop`,
// `rm` and `logs` all fail permanently), and P4-T1 needs the worker set to attribute a session it
// just spawned to its id without parsing prose (F.2.5).
//
// **It takes a `SubscriptionId`, never a path**, which is SEC-FS-1's last sentence as a signature:
// nothing outside the adapter chooses which file is opened. The `RosterView` it returns is the
// field allowlist from `contracts/daemon-roster.ts`, so nothing above the adapter can leak a field
// it never received (SEC-FS-2, DECISIONS.md D24).
//
// The port and the fake arriving before the use case is the P1-T3 pattern: `Store` landed eleven
// tasks before anything wrote to it, and the alternative — a use case and its adapter in one
// commit — is what makes a layer boundary a thing you argue about later.
import type { RosterView } from '../../contracts/daemon-roster.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

export interface RosterSource {
  /**
   * The roster for one subscription, or `undefined` when there is none to read.
   *
   * `undefined` and an empty view are deliberately different answers. No roster at all is the
   * ordinary state of a subscription that has never run a `--bg` session; a view whose `workers`
   * is empty is a daemon that says it is running nothing, which is what a caller checking for a
   * dead supervisor has to be able to tell apart.
   *
   * @throws never — a torn read is ordinary (the daemon rewrites this file while it runs), and a
   * refused or absent file is not an error either.
   */
  read(subscription: SubscriptionId): RosterView | undefined;
}

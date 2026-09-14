// Reading `daemon/roster.json`, and reading as little of it as possible — P1-T14, SEC-FS-1/-2.
//
// Three narrowings, in the order they apply, because each one catches what the next cannot:
//
//  1. **The path is derived, never accepted.** `read` takes a `SubscriptionId` from the closed
//     union and asks `ClaudeInstall` for the directory (SEC-FS-1: "sessions are addressed by id,
//     never by client-supplied path"). There is no parameter a caller could point elsewhere.
//  2. **`ReadPolicy` is asked anyway.** The path this builds is on the allowlist by construction,
//     so today the check can only pass — which is the point of having it: SEC-FS-2 says a
//     deny-list check runs before *every* open, and the day someone adds a path parameter here the
//     check is already in place rather than being remembered. It costs one string comparison.
//  3. **`projectRoster` discards every field that is not named.** An allowlist, not a deny-list:
//     `rvAuth` and `ptyAuth` are 32 hex characters of pipe auth and `dispatch` carries the full
//     prompt text of every background session (RESEARCH.md F.2.10), and a roster that grows a
//     fourth secret in the next Claude Code release is dropped without anyone editing this file.
//
// **What is read is still the whole file.** The narrowing is about what leaves this class, not
// about what `readFileSync` touches — there is no way to read half a JSON document, and pretending
// otherwise would be the sort of claim SECURITY.md should not make. The secrets are in memory for
// the length of one `JSON.parse` and are never returned, logged or stored.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoster, type RosterView } from '../../../contracts/daemon-roster.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { ReadPolicy } from '../../domain/read-policy.ts';
import type { RosterSource } from '../../ports/roster-source.ts';

/** Claude Code's own layout, relative to a config directory (RESEARCH.md F.2.10). */
const ROSTER = join('daemon', 'roster.json');

/** Just the part of `ClaudeInstall` this needs, so the adapter is testable without one. */
export interface ConfigDirectories {
  configDirFor(subscription: SubscriptionId): string;
}

export class FsRosterSource implements RosterSource {
  private readonly directories: ConfigDirectories;
  private readonly policy: ReadPolicy;

  /**
   * @param directories where each subscription's config directory is — `ClaudeInstall` in
   * production, a two-entry stand-in in a test.
   * @param policy defaults to one built from the same directories, because a policy that
   * disagreed with them would refuse every read (SEC-FS-1). Pass one to test a refusal.
   */
  constructor(directories: ConfigDirectories, policy?: ReadPolicy) {
    this.directories = directories;
    this.policy = policy ?? new ReadPolicy(subscriptionDirectories(directories));
  }

  /** @throws never — see the port. Absent, torn, refused and unparseable are all `undefined`. */
  public read(subscription: SubscriptionId): RosterView | undefined {
    const path = join(this.directories.configDirFor(subscription), ROSTER);
    if (!this.policy.allows(path)) return undefined;
    const parsed = this.parse(path);
    return parsed === undefined ? undefined : projectRoster(parsed);
  }

  /**
   * The file as JSON, or `undefined`.
   *
   * Both failures are ordinary and neither is distinguished: there is no roster until the first
   * `--bg` session, and the daemon rewrites the file in place while it runs, so a read can land
   * mid-write and yield invalid JSON (F.2.10). A caller that treated either as an error would
   * report a problem on a machine that has simply never run a background session.
   */
  private parse(path: string): unknown {
    try {
      const text = readFileSync(path, 'utf8');
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return undefined;
    }
  }
}

/**
 * The two config directories, as the policy's roots.
 *
 * Spelled out rather than iterated over `SUBSCRIPTION_IDS` inside the constructor so the default
 * is one expression: a policy built from the same source as the paths it screens cannot disagree
 * with them, which is the failure that would make this adapter silently return nothing.
 */
function subscriptionDirectories(directories: ConfigDirectories): readonly string[] {
  return [directories.configDirFor('365'), directories.configDirFor('isg')];
}

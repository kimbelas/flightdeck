// What changed in a folder's configuration, and when — P3-T7, SPEC §5.1's first enhancement.
//
// **It writes, where its three neighbours do not.** `ProjectStatusReader`, `WorkflowMapReader` and
// `ObservedReader` all produce readings that go nowhere (DECISIONS.md D37): a branch name is a fact
// about now, and storing it would make the one table that says "which folders may core read" change
// every time somebody commits. A config CHANGE is the opposite kind of fact — it is an observation
// that something happened, at an instant, and it is unrecoverable once the file has been edited
// again. That is precisely what the store is for, and why `config_snapshots` sits beside `events`
// and `vitals_snapshots` rather than beside `projects`.
//
// **A row per change, not per read.** `/projects/map` is answered on every deck load. The digest is
// computed each time — it is set arithmetic over a few hundred strings, microseconds — and a row is
// written only when it moves. So the table grows with what happened in the repository, not with how
// often somebody looked at it.
//
// **A first sighting is not a change**, and this is the one rule that had to be decided rather than
// discovered: the first read of a newly imported folder finds seventeen hooks and no previous
// snapshot, and reporting them all as "added" would mean every project announced a change on the
// day it was imported. It records the snapshot and says nothing.
//
// **What it answers is the LAST change, not the change since you last looked.** A row that said
// "hooks changed" once and then went blank on reload would be a feature that erases itself. So a
// folder whose config has not moved since yesterday still reports yesterday's change, computed from
// the two newest snapshots, and writes nothing.
import {
  configDigest,
  diffDigests,
  sameDigest,
  type ConfigDigest,
  type ConfigDrift,
} from '../../contracts/config-snapshot.ts';
import { projectKey } from '../../contracts/project.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import type { Clock } from '../ports/clock.ts';
import type { ConfigSnapshot, DraftConfigSnapshot } from '../ports/store.ts';
import type { Logger } from '../ports/logger.ts';

/**
 * The two methods of `Store` this needs.
 *
 * A port of its own rather than `Store` itself, for the reason every narrow interface in core is
 * one: a test of "a first sighting reports nothing" should not have to own an event log, an audit
 * table and a project registry.
 */
export interface ConfigStore {
  rememberConfigSnapshot(snapshot: DraftConfigSnapshot): ConfigSnapshot;
  configSnapshots(projectKeyValue: string, limit: number): readonly ConfigSnapshot[];
}

/** The two the historian reads: what the config is now, and what it was before that. */
const SNAPSHOTS_READ = 2;

export interface ConfigHistorianParts {
  readonly store: ConfigStore;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class ConfigHistorian {
  private readonly parts: ConfigHistorianParts;

  constructor(parts: ConfigHistorianParts) {
    this.parts = parts;
  }

  /**
   * Records each map's configuration if it moved, and answers the drifts there are.
   *
   * A folder that has never changed since it was imported is absent from the answer rather than
   * present with an empty change list — the deck draws nothing for it, and "nothing has changed
   * here" is not a sentence worth a row.
   */
  public observeAll(maps: readonly WorkflowMap[]): readonly ConfigDrift[] {
    return maps.flatMap((map) => {
      const drift = this.observe(map);
      return drift === undefined ? [] : [drift];
    });
  }

  /** One folder. See the header for the three cases. */
  public observe(map: WorkflowMap): ConfigDrift | undefined {
    const key = projectKey(map.path);
    const digest = configDigest(map);
    const held = this.read(key);

    const latest = held[0];
    if (latest === undefined) {
      // First sighting. Recorded so the NEXT change has something to be a change from.
      this.remember(key, digest);
      return undefined;
    }

    if (!sameDigest(latest.digest, digest)) {
      const now = this.remember(key, digest);
      return {
        path: map.path,
        at: now?.takenAt ?? this.parts.clock.now().getTime(),
        previousAt: latest.takenAt,
        changes: diffDigests(latest.digest, digest),
      };
    }

    // Unchanged since the last snapshot. Report the change that PRODUCED it, if there was one —
    // the second row is what makes "hooks changed on Tuesday" survive Wednesday's reload.
    const previous = held[1];
    if (previous === undefined) return undefined;
    return {
      path: map.path,
      at: latest.takenAt,
      previousAt: previous.takenAt,
      changes: diffDigests(previous.digest, latest.digest),
    };
  }

  /**
   * The history, or nothing.
   *
   * A store that cannot be read is a reason to report no drift, never a reason to fail the map
   * request it rides on: the configuration is still on screen and only the "what changed" line is
   * missing. The same trade `ProjectGitReader` makes about a `git` spawn that fails.
   */
  private read(key: string): readonly ConfigSnapshot[] {
    try {
      return this.parts.store.configSnapshots(key, SNAPSHOTS_READ);
    } catch {
      this.parts.logger.warn('config_history_unreadable', { project: key });
      return [];
    }
  }

  /** @returns the stored snapshot, or `undefined` if the store refused the write. */
  private remember(key: string, digest: ConfigDigest): ConfigSnapshot | undefined {
    try {
      return this.parts.store.rememberConfigSnapshot({
        projectKey: key,
        takenAt: this.parts.clock.now().getTime(),
        digest,
      });
    } catch {
      this.parts.logger.warn('config_snapshot_unwritable', { project: key });
      return undefined;
    }
  }
}

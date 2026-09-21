// Which project a session is in — P3-T6, SPEC §5.6's "one row per imported project".
//
// The deck has had the two halves since P3-T1 and P1-T9 and never joined them: the registry says
// which folders are projects, every session row carries a `cwd`, and nothing matched one to the
// other. This is that match, as a pure object with no DOM in it, so the rule can be tested rather
// than inspected.
//
// **A project is its folder AND its worktrees, which is what SPEC calls a project group.** P3-T4
// already discovers every checkout of an imported repository (`WorkflowMap.worktrees`), and a
// session started in `..\.claude\worktrees\ticket-41` is a session in that project by any reading
// a person would give — it is the same repository, the same `.claude`, the same work. Grouping
// them is therefore a derivation over data the deck already has rather than a thing to store.
//
// What is NOT built is a group of unrelated sibling folders (SPEC's `app-core` + `app-next`).
// Nothing on this machine is one, a group nobody can name a member of is a feature with no user,
// and it would need a name, a store and a UI of its own. Worktrees are the half that exists.
//
// **Longest match wins**, because an imported folder can contain another. The deeper folder is the
// more specific answer, and a session in `repo\packages\web` belongs to `packages\web` when that
// is imported too — the same rule a router uses and the opposite of first-match-wins, which would
// hand it to whichever folder happened to be imported first.
import type { ProjectRecord } from '../../contracts/project.ts';
import { projectKey } from '../../contracts/project.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import { canonicalWindowsPath, isUnder } from '../../contracts/windows-path.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';

/** What the sessions in one project add up to. Both fields are counts of what is on screen. */
export interface ProjectActivity {
  /** Sessions whose cwd is this project or one of its worktrees, across both subscriptions. */
  readonly sessions: number;
  /** Of those, the ones core says are running. */
  readonly live: number;
  /** The newest `startedAt` among them, or `undefined` when there are none. */
  readonly lastStartedAt: number | undefined;
}

export const NO_ACTIVITY: ProjectActivity = {
  sessions: 0,
  live: 0,
  lastStartedAt: undefined,
};

/** One project's folders, canonicalised — the root first, then every worktree of it. */
interface Scope {
  readonly key: string;
  readonly folders: readonly string[];
}

export class ProjectScope {
  private readonly scopes: readonly Scope[];

  constructor(projects: readonly ProjectRecord[], maps: Readonly<Record<string, WorkflowMap>>) {
    this.scopes = projects.map((project) => {
      const key = projectKey(project.path);
      const worktrees = (maps[key]?.worktrees ?? []).map((tree) => canonicalWindowsPath(tree.path));
      // The root first and duplicates dropped: `git worktree list` names the main checkout too,
      // and it is usually the imported folder itself.
      return { key, folders: [...new Set([canonicalWindowsPath(project.path), ...worktrees])] };
    });
  }

  /**
   * Which project this working directory is in, or `undefined` for one outside every project.
   *
   * `undefined` is the ordinary answer rather than an edge case: the registry ships empty and grows
   * one deliberate import at a time (D26), so most sessions on this machine are in folders nobody
   * has imported. They are not errors and they are not hidden — they are what "All projects" shows.
   */
  public keyFor(cwd: string): string | undefined {
    const canonical = canonicalWindowsPath(cwd);
    let best: { key: string; depth: number } | undefined;
    for (const scope of this.scopes) {
      for (const folder of scope.folders) {
        if (!isUnder(canonical, folder)) continue;
        if (best === undefined || folder.length > best.depth) {
          best = { key: scope.key, depth: folder.length };
        }
      }
    }
    return best?.key;
  }

  /**
   * The rows in one project, or every row when no project is current.
   *
   * Filtering rather than sorting: "by project" is a narrowing of the list the deck already draws,
   * so a session that is filtered out is one the header still counts and the palette still reaches
   * — exactly what `/`'s search box already does (`DeckBody`).
   */
  public rowsIn(key: string | undefined, rows: readonly SessionRow[]): readonly SessionRow[] {
    if (key === undefined) return rows;
    return rows.filter((row) => this.keyFor(row.cwd) === key);
  }

  /** What each project's sessions add up to, keyed by `projectKey`. */
  public activity(rows: readonly SessionRow[]): Readonly<Record<string, ProjectActivity>> {
    const totals = new Map<string, { sessions: number; live: number; lastStartedAt: number }>();
    for (const row of rows) {
      const key = this.keyFor(row.cwd);
      if (key === undefined) continue;
      const held = totals.get(key) ?? { sessions: 0, live: 0, lastStartedAt: 0 };
      totals.set(key, {
        sessions: held.sessions + 1,
        live: held.live + (row.live ? 1 : 0),
        lastStartedAt: Math.max(held.lastStartedAt, row.startedAt),
      });
    }
    return Object.fromEntries(
      [...totals].map(([key, held]) => [
        key,
        { sessions: held.sessions, live: held.live, lastStartedAt: held.lastStartedAt },
      ]),
    );
  }

  /** How many sessions are in no imported project at all — what "All projects" has extra. */
  public unassigned(rows: readonly SessionRow[]): number {
    return rows.filter((row) => this.keyFor(row.cwd) === undefined).length;
  }

  /** Whether `key` still names an imported project. A stored one can outlive its import. */
  public has(key: string): boolean {
    return this.scopes.some((scope) => scope.key === key);
  }
}

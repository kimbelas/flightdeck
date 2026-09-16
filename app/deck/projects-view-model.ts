// What the projects panel renders — P3-T1, CODING-STANDARDS §3 ("React is not exempt from OOP").
//
// A class rather than logic in the component, for the usual reason and one specific to this panel:
// **turning a refusal code into a sentence is a decision, not markup.** Core answers with a closed
// union (`ImportRefusal`) precisely so that nothing it says was composed from what the request
// contained, and the English lives on this side because that is where the reader is. A component
// with a `switch` inside its JSX would be a decision nobody can unit-test.
//
// **The sentences say what to do, not what happened.** "That folder is not there" is a typo the
// owner fixes in two seconds; "that is a Claude Code config directory" is a rule they need to know
// once. A refusal that only restated its own code would be the code, spelled longer.
//
// **Turning a git reading into a phrase is the same kind of decision** (P3-T2). Core answers with
// numbers — `dirty: 3`, `ahead: 2` — because a number is something both ends can reason about, and
// "3 changed · 2 ahead" is English that belongs where the reader is. `clean` is the case worth
// naming: a repository with nothing in any of the four counts says so out loud rather than
// rendering an empty space that reads as "not loaded yet".
import type { GitStatus } from '../../contracts/git-status.ts';
import type { ProjectStatus, StackLabel } from '../../contracts/project-status.ts';
import type { ImportRefusal, ProjectRecord } from '../../contracts/project.ts';
import { projectKey } from '../../contracts/project.ts';

/**
 * One line per refusal. Exhaustive over `ImportRefusal` by construction — a `Record` of the union,
 * so adding a refusal in `contracts/` stops this file compiling until somebody writes its sentence.
 */
const SENTENCES: Readonly<Record<ImportRefusal, string>> = {
  empty: 'Type the full path to a folder.',
  not_absolute: 'Give the whole path, starting with a drive letter — C:\\Users\\… .',
  too_long: 'That path is too long to be a folder.',
  traversal: 'Paths with `..` in them are refused — give the folder itself.',
  missing: 'There is no folder at that path.',
  not_a_directory: 'That is a file. Import the folder it is in.',
  config_directory: 'That is a Claude Code config directory, or it contains one. Pick a project.',
};

/** One imported project, ready to draw. */
export interface ProjectLine {
  /** `projectKey` — the React key, and what the withdraw button sends back. */
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly importedAt: number;
  /** The detected stack, already in display order. Empty for a folder with no marker. */
  readonly stack: readonly StackLabel[];
  /**
   * The branch, or `undefined` for a detached HEAD, a folder that is not a repository, and one
   * whose reading has not arrived yet. A panel draws nothing for all four.
   */
  readonly branch: string | undefined;
  /** `clean`, or what is outstanding — `3 changed · 2 ahead`. `undefined` when there is no git. */
  readonly gitSummary: string | undefined;
  /** `merging`, `rebasing` … when git is mid-operation. It changes what every other count means. */
  readonly progress: string | undefined;
}

/** What a repository with nothing outstanding says. Named, because blank would read as unread. */
const CLEAN = 'clean';

/**
 * What to say when nothing has been imported.
 *
 * It describes the design rather than apologising for a gap: the registry ships empty because
 * importing is the owner's act and nothing scans the disk (D26), and a panel that said "no
 * projects found" would read as a search that failed.
 */
const NOTHING_YET =
  'No projects yet. Import a folder by its full path — nothing is scanned or copied.';

export class ProjectsViewModel {
  /** Exposed as a field so the panel and its test name the same string (see `NOTHING_YET`). */
  public readonly emptyMessage: string = NOTHING_YET;

  private readonly projects: readonly ProjectRecord[];
  private readonly refusal: ImportRefusal | undefined;
  private readonly statuses: Readonly<Record<string, ProjectStatus>>;

  constructor(
    projects: readonly ProjectRecord[],
    refusal: ImportRefusal | undefined,
    statuses: Readonly<Record<string, ProjectStatus>> = {},
  ) {
    this.projects = projects;
    this.refusal = refusal;
    this.statuses = statuses;
  }

  /**
   * The rows, each with whatever reading has arrived for it.
   *
   * The registry drives the list and the readings only annotate it — a status for a folder that is
   * no longer imported draws nothing, because there is no row to draw it on. That is the right way
   * round: the record is the permission, and the reading is a comment on it.
   */
  public get lines(): readonly ProjectLine[] {
    return this.projects.map((project) => {
      const key = projectKey(project.path);
      const git = this.statuses[key]?.git;
      return {
        key,
        name: project.name,
        path: project.path,
        importedAt: project.importedAt,
        stack: this.statuses[key]?.stack ?? [],
        branch: git?.branch,
        gitSummary: git === undefined ? undefined : summarise(git),
        progress: git?.progress,
      };
    });
  }

  public get isEmpty(): boolean {
    return this.projects.length === 0;
  }

  /** The refusal in English, or `undefined` when the last import was taken. */
  public get problem(): string | undefined {
    return this.refusal === undefined ? undefined : SENTENCES[this.refusal];
  }
}

/**
 * The four counts as a phrase, in the order somebody acts on them.
 *
 * Conflicts first because a conflict blocks everything else, then the working tree, then the two
 * halves of the divergence. Each part is omitted when it is zero rather than printed as `0`, which
 * is what keeps the usual case to two words instead of four zeroes.
 */
function summarise(git: GitStatus): string {
  const parts = [
    counted(git.conflicts, 'conflict', 'conflicts'),
    counted(git.dirty, 'changed', 'changed'),
    counted(git.ahead, 'ahead', 'ahead'),
    counted(git.behind, 'behind', 'behind'),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? CLEAN : parts.join(' · ');
}

/**
 * `2 conflicts`, or nothing at all when the count is zero.
 *
 * Both words are given rather than an `s` appended, because three of the four do not take one —
 * "2 changeds" is the bug that rule would write.
 */
function counted(count: number, one: string, many: string): string | undefined {
  if (count <= 0) return undefined;
  return `${String(count)} ${count === 1 ? one : many}`;
}

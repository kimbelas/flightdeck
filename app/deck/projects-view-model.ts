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
}

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

  constructor(projects: readonly ProjectRecord[], refusal: ImportRefusal | undefined) {
    this.projects = projects;
    this.refusal = refusal;
  }

  public get lines(): readonly ProjectLine[] {
    return this.projects.map((project) => ({
      key: projectKey(project.path),
      name: project.name,
      path: project.path,
      importedAt: project.importedAt,
    }));
  }

  public get isEmpty(): boolean {
    return this.projects.length === 0;
  }

  /** The refusal in English, or `undefined` when the last import was taken. */
  public get problem(): string | undefined {
    return this.refusal === undefined ? undefined : SENTENCES[this.refusal];
  }
}

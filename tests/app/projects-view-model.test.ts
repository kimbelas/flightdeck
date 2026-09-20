// What the projects panel renders — P3-T1.
//
// Every case here is one the component cannot be asked about without a DOM, which is the reason
// the view model exists (CODING-STANDARDS §3).
import { describe, expect, it } from 'vitest';
import { IMPORT_REFUSALS, projectKey, type ProjectRecord } from '../../contracts/project.ts';
import type { GitStatus } from '../../contracts/git-status.ts';
import type { ProjectStatus } from '../../contracts/project-status.ts';
import { ProjectsViewModel } from '../../app/deck/projects-view-model.ts';

const APP_NEXT: ProjectRecord = {
  path: 'C:\\Users\\belas\\Documents\\development\\app-next',
  name: 'app-next',
  importedAt: 1_700_000_000_000,
};

describe('ProjectsViewModel', () => {
  it('is empty before anything is imported, and says why rather than apologising', () => {
    const model = new ProjectsViewModel([], undefined);

    expect(model.isEmpty).toBe(true);
    // "No projects found" would read as a search that failed. Nothing searched.
    expect(model.emptyMessage).toContain('nothing is scanned');
  });

  it('gives every project a key, a name and its path', () => {
    const [line] = new ProjectsViewModel([APP_NEXT], undefined).lines;

    expect(line).toMatchObject({
      key: 'c:\\users\\belas\\documents\\development\\app-next',
      name: 'app-next',
      path: APP_NEXT.path,
      importedAt: APP_NEXT.importedAt,
      // Nothing read yet, which is the state every row starts in: the registry is fetched first
      // and the readings follow (P3-T2).
      stack: [],
      branch: undefined,
      gitSummary: undefined,
      progress: undefined,
    });
    // The workflow map is nested rather than a second list the panel aligns by key, and a row
    // whose map has not arrived answers `isKnown: false` and draws no section (P3-T3).
    expect(line?.map.isKnown).toBe(false);
  });

  it('keys two spellings of one folder the same, so a re-import cannot duplicate a row', () => {
    const shouted: ProjectRecord = { ...APP_NEXT, path: APP_NEXT.path.toUpperCase() };

    const keys = new ProjectsViewModel([APP_NEXT, shouted], undefined).lines.map((l) => l.key);

    expect(new Set(keys).size).toBe(1);
  });

  it('has nothing to say when the last import was taken', () => {
    expect(new ProjectsViewModel([APP_NEXT], undefined).problem).toBeUndefined();
  });

  it('turns every refusal core can send into a sentence', () => {
    // The table is exhaustive by construction — `SENTENCES` is a `Record` of the union, so a new
    // refusal stops the view model compiling. This asserts the other half: that none is blank.
    for (const refusal of IMPORT_REFUSALS) {
      const problem = new ProjectsViewModel([], refusal).problem ?? '';

      expect(problem.length).toBeGreaterThan(10);
      // And that it is English rather than the code spelled longer.
      expect(problem).not.toContain(refusal);
    }
  });

  it('says what to do about the two that are worth knowing', () => {
    expect(new ProjectsViewModel([], 'missing').problem).toContain('no folder');
    expect(new ProjectsViewModel([], 'config_directory').problem).toContain('config directory');
  });
});

/** A reading for `APP_NEXT`, keyed the way the store keys them. */
function reading(
  git: Partial<GitStatus> | undefined,
  stack: ProjectStatus['stack'] = [],
): Readonly<Record<string, ProjectStatus>> {
  const whole: GitStatus | undefined =
    git === undefined
      ? undefined
      : {
          branch: 'main',
          ahead: 0,
          behind: 0,
          dirty: 0,
          conflicts: 0,
          progress: undefined,
          ...git,
        };
  return {
    [projectKey(APP_NEXT.path)]: { path: APP_NEXT.path, at: 1, stack, git: whole },
  };
}

describe('ProjectsViewModel — stack and git (P3-T2)', () => {
  it('draws nothing at all for a row whose reading has not arrived', () => {
    // The registry is fetched first and the readings follow, so every row spends a moment here.
    // A row that waited for its branch would be a list that took two round trips to appear.
    const [line] = new ProjectsViewModel([APP_NEXT], undefined).lines;

    expect([line?.stack, line?.branch, line?.gitSummary]).toEqual([[], undefined, undefined]);
  });

  it('carries the stack in the order core detected it', () => {
    const model = new ProjectsViewModel(
      [APP_NEXT],
      undefined,
      reading(undefined, ['Next.js', 'Node']),
    );

    expect(model.lines[0]?.stack).toEqual(['Next.js', 'Node']);
  });

  it('says a repository with nothing outstanding is clean, rather than leaving it blank', () => {
    // Blank reads as "not loaded yet", which is a different thing and is already on screen for a
    // row whose reading has not arrived.
    const model = new ProjectsViewModel([APP_NEXT], undefined, reading({}));

    expect(model.lines[0]?.gitSummary).toBe('clean');
    expect(model.lines[0]?.branch).toBe('main');
  });

  it('turns the counts into a phrase, in the order somebody acts on them', () => {
    const model = new ProjectsViewModel(
      [APP_NEXT],
      undefined,
      reading({ conflicts: 2, dirty: 3, ahead: 1, behind: 4 }),
    );

    expect(model.lines[0]?.gitSummary).toBe('2 conflicts · 3 changed · 1 ahead · 4 behind');
  });

  it('leaves out what is zero rather than printing it', () => {
    const model = new ProjectsViewModel([APP_NEXT], undefined, reading({ dirty: 1 }));

    expect(model.lines[0]?.gitSummary).toBe('1 changed');
  });

  it('counts one conflict in the singular', () => {
    const model = new ProjectsViewModel([APP_NEXT], undefined, reading({ conflicts: 1 }));

    expect(model.lines[0]?.gitSummary).toBe('1 conflict');
  });

  it('shows no branch for a detached HEAD but still says what is outstanding', () => {
    const model = new ProjectsViewModel(
      [APP_NEXT],
      undefined,
      reading({ branch: undefined, dirty: 2 }),
    );

    expect(model.lines[0]?.branch).toBeUndefined();
    expect(model.lines[0]?.gitSummary).toBe('2 changed');
  });

  it('surfaces the in-progress state, because it changes what every other count means', () => {
    // 3 dirty files during a rebase is a conflict to finish, not work in progress.
    const model = new ProjectsViewModel([APP_NEXT], undefined, reading({ progress: 'rebasing' }));

    expect(model.lines[0]?.progress).toBe('rebasing');
  });

  it('ignores a reading for a folder that is no longer imported', () => {
    // The registry drives the list; a reading only annotates it. There is no row to draw this on.
    const model = new ProjectsViewModel([], undefined, reading({}));

    expect(model.lines).toEqual([]);
  });
});

// What the projects panel renders — P3-T1.
//
// Every case here is one the component cannot be asked about without a DOM, which is the reason
// the view model exists (CODING-STANDARDS §3).
import { describe, expect, it } from 'vitest';
import { IMPORT_REFUSALS, type ProjectRecord } from '../../contracts/project.ts';
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

    expect(line).toEqual({
      key: 'c:\\users\\belas\\documents\\development\\app-next',
      name: 'app-next',
      path: APP_NEXT.path,
      importedAt: APP_NEXT.importedAt,
    });
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

// The wire shape of an imported project — P3-T1.
import { describe, expect, it } from 'vitest';
import {
  IMPORT_REFUSALS,
  MAX_PROJECT_NAME_CHARS,
  MAX_PROJECT_PATH_CHARS,
  parseImportRefusal,
  parseProject,
  parseProjectList,
  parseProjectPathBody,
  projectKey,
  projectName,
  projectSlug,
} from '../../contracts/project.ts';

const PATH = 'C:\\Users\\belas\\Documents\\development\\app-next';

describe('projectKey', () => {
  it('reads two spellings of one folder as one project', () => {
    expect(projectKey('C:/Users/belas/Documents')).toBe(
      projectKey('C:\\USERS\\belas\\Documents\\'),
    );
  });
});

// Read off this machine's own `projects/` folders, both config dirs (P3-T5, P7-T3).
describe('projectSlug', () => {
  it('turns every separator and the colon into a dash', () => {
    expect(projectSlug('C:\\Users\\belas\\Documents\\development\\flightdeck')).toBe(
      'C--Users-belas-Documents-development-flightdeck',
    );
  });

  it('turns a dot into a dash too — a worktree under .claude has one', () => {
    expect(projectSlug('C:\\dev\\xpert-new\\.claude\\worktrees\\xweb-1941')).toBe(
      'C--dev-xpert-new--claude-worktrees-xweb-1941',
    );
  });
});

describe('projectName', () => {
  it('is the last segment', () => {
    expect(projectName(PATH)).toBe('app-next');
  });

  it('keeps the casing the filesystem gave it', () => {
    // NOT `projectKey`: a folder called `AppNext` must not appear in the deck as `appnext`.
    expect(projectName('C:\\Users\\belas\\AppNext')).toBe('AppNext');
  });

  it('survives a trailing separator and a forward slash', () => {
    expect(projectName('C:/Users/belas/docs-tool/')).toBe('docs-tool');
  });

  it('answers with the drive for a drive root, which has no last segment', () => {
    expect(projectName('C:\\')).toBe('C:');
  });

  it('caps a preposterous folder name', () => {
    expect(projectName(`C:\\${'a'.repeat(400)}`)).toHaveLength(MAX_PROJECT_NAME_CHARS);
  });
});

describe('parseProject', () => {
  it('reads a record', () => {
    expect(parseProject({ path: PATH, name: 'app-next', importedAt: 1_700_000_000_000 })).toEqual({
      path: PATH,
      name: 'app-next',
      importedAt: 1_700_000_000_000,
    });
  });

  it('re-derives a name the row lost, rather than refusing the project', () => {
    // A project row is a standing permission. Losing its label must not lose the permission, and
    // an unnamed entry is one nobody can identify well enough to withdraw.
    expect(parseProject({ path: PATH, importedAt: 1 })?.name).toBe('app-next');
  });

  it('caps a name long enough to break the list', () => {
    const parsed = parseProject({ path: PATH, name: 'n'.repeat(500), importedAt: 1 });

    expect(parsed?.name).toHaveLength(MAX_PROJECT_NAME_CHARS);
  });

  const refused: readonly [string, unknown][] = [
    ['not an object', 'C:\\x'],
    ['null', null],
    ['no path', { importedAt: 1 }],
    ['an empty path', { path: '', importedAt: 1 }],
    [
      'a path over the cap',
      { path: 'C:\\'.padEnd(MAX_PROJECT_PATH_CHARS + 1, 'a'), importedAt: 1 },
    ],
    ['no importedAt', { path: PATH }],
    ['a NaN importedAt', { path: PATH, importedAt: Number.NaN }],
  ];

  for (const [what, value] of refused) {
    it(`refuses ${what}`, () => {
      expect(parseProject(value)).toBeUndefined();
    });
  }
});

describe('parseProjectList', () => {
  it('reads the registry out of a GET /projects body', () => {
    const body = { projects: [{ path: PATH, name: 'app-next', importedAt: 2 }] };

    expect(parseProjectList(body)).toHaveLength(1);
  });

  it('drops what it cannot read rather than losing the rest', () => {
    // The rule every parser in this folder follows: one unreadable row must not cost the deck the
    // other nine.
    const body = { projects: [{ path: PATH, importedAt: 2 }, { nonsense: true }, 7] };

    expect(parseProjectList(body)).toHaveLength(1);
  });

  it('is empty for a body that is not a registry', () => {
    for (const body of [undefined, null, 'projects', { projects: 'none' }, {}]) {
      expect(parseProjectList(body)).toEqual([]);
    }
  });
});

describe('parseProjectPathBody', () => {
  it('reads the one field both mutations take', () => {
    expect(parseProjectPathBody(JSON.stringify({ path: PATH }))).toBe(PATH);
  });

  it('reads every shape of nothing as nothing', () => {
    // A body that is not JSON, is not an object, has no `path`, or has a blank one — all the same
    // answer, because `empty` is what the registry would have said about all four.
    for (const body of ['', 'not json', '[]', '{}', '{"path":123}', '{"path":"   "}']) {
      expect(parseProjectPathBody(body)).toBeUndefined();
    }
  });
});

describe('parseImportRefusal', () => {
  it('reads every refusal this build knows', () => {
    for (const refusal of IMPORT_REFUSALS) {
      expect(parseImportRefusal({ error: refusal })).toBe(refusal);
    }
  });

  it('refuses one it does not, rather than passing a string through to the screen', () => {
    for (const body of [{ error: 'something_new' }, { error: 7 }, {}, null, 'empty']) {
      expect(parseImportRefusal(body)).toBeUndefined();
    }
  });
});

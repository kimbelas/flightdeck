// `installed_plugins.json` as measured, and the scope rule that decides where an install applies —
// P9-T5. The fixture is the owner's 365 index, scrubbed: two `user` installs and four `project`
// installs for one folder that is not imported.
import { describe, expect, it } from 'vitest';
import {
  installAppliesTo,
  parseInstalledPlugins,
  type PluginInstall,
} from '../../contracts/installed-plugins.ts';
import captured from '../../fixtures/plugins/installed-plugins.json' with { type: 'json' };

const HERE = 'C:\\Users\\dev\\Documents\\development\\app-next';
const CACHE = 'C:\\Users\\dev\\.claude-365\\plugins\\cache\\m';

function install(overrides: Partial<PluginInstall> = {}): PluginInstall {
  return { plugin: 'p', scope: 'user', projectPath: undefined, installPath: CACHE, ...overrides };
}

describe('parseInstalledPlugins', () => {
  it('reads the captured index: six installs, named by the key before the @', () => {
    const installs = parseInstalledPlugins(captured);

    expect(installs.map((entry) => [entry.plugin, entry.scope])).toEqual([
      ['context-hygiene', 'user'],
      ['shell-review', 'user'],
      ['superpowers', 'project'],
      ['typescript-lsp', 'project'],
      ['chrome-devtools-mcp', 'project'],
      ['frontend-design', 'project'],
    ]);
    expect(installs[0]?.projectPath).toBeUndefined();
    expect(installs[2]?.projectPath).toMatch(/^C:\\Users\\/u);
  });

  it('drops what it cannot use rather than guessing', () => {
    const installs = parseInstalledPlugins({
      plugins: {
        'Bad Name@m': [{ scope: 'user', installPath: CACHE }],
        'no-scope@m': [{ installPath: CACHE }],
        'odd-scope@m': [{ scope: 'managed', installPath: CACHE }],
        'no-path@m': [{ scope: 'user' }],
        'orphan@m': [{ scope: 'project', installPath: CACHE }],
        'not-a-list@m': { scope: 'user', installPath: CACHE },
        'kept@m': [null, 'x', { scope: 'local', projectPath: HERE, installPath: CACHE }],
      },
    });

    expect(installs).toEqual([
      { plugin: 'kept', scope: 'local', projectPath: HERE, installPath: CACHE },
    ]);
  });

  it('answers nothing for a file that is not the index', () => {
    expect(parseInstalledPlugins(undefined)).toEqual([]);
    expect(parseInstalledPlugins([])).toEqual([]);
    expect(parseInstalledPlugins({ plugins: [] })).toEqual([]);
  });

  it('keeps a user install free of any project path it was written with', () => {
    const [entry] = parseInstalledPlugins({
      plugins: { 'p@m': [{ scope: 'user', projectPath: HERE, installPath: CACHE }] },
    });
    expect(entry?.projectPath).toBeUndefined();
  });
});

describe('installAppliesTo', () => {
  it('applies a user install everywhere', () => {
    expect(installAppliesTo(install(), [HERE])).toBe(true);
  });

  it('applies a project install only to its own folder, whatever the case or separators', () => {
    const scoped = install({ scope: 'project', projectPath: HERE });

    expect(installAppliesTo(scoped, [HERE.toUpperCase().replaceAll('\\', '/')])).toBe(true);
    expect(installAppliesTo(scoped, [`${HERE}-other`])).toBe(false);
    expect(installAppliesTo(scoped, ['C:\\elsewhere', HERE])).toBe(true);
  });

  it('never applies a scoped install that names no folder', () => {
    expect(installAppliesTo(install({ scope: 'local' }), [HERE])).toBe(false);
  });
});

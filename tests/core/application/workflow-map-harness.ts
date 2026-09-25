// Scaffolding for the `workflow-map-reader` test files — split for `max-lines`, the way
// `spend-ledger-harness.ts` was. A little filesystem shaped like `app-next`, the real readers over
// it, and one user-scope plugin to install into the 365 config dir.
import { ClaudeAssetReader } from '../../../core/application/claude-asset-reader.ts';
import { ProjectTicketReader } from '../../../core/application/project-ticket-reader.ts';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { InstructionStackReader } from '../../../core/application/instruction-stack-reader.ts';
import { PluginAssetReader } from '../../../core/application/plugin-asset-reader.ts';
import { WorkflowMapReader } from '../../../core/application/workflow-map-reader.ts';
import { WorktreeReader } from '../../../core/application/worktree-reader.ts';
import { projectKey, type ProjectRecord } from '../../../contracts/project.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

export const APP = 'C:\\Users\\belas\\Documents\\development\\app-next';
export const DOCS = 'C:\\Users\\belas\\Documents\\development\\docs-tool';
export const C365 = 'C:\\Users\\belas\\.claude-365';
export const ISG = 'C:\\Users\\belas\\.claude-isg';
export const AT = 1000;
export const MAP_TTL = 300_000;

export const SETTINGS = JSON.stringify({
  permissions: { allow: ['Bash(git status:*)'], deny: ['Read(.env)'] },
  enabledPlugins: { 'context-hygiene@claude-kit': true },
  extraKnownMarketplaces: { 'claude-kit': {} },
  hooks: { PreCompact: [{ hooks: [{ command: 'node state-dump.mjs', timeout: 15 }] }] },
});

export interface Harness {
  readonly reader: WorkflowMapReader;
  readonly files: FakeProjectFiles;
  readonly clock: FakeClock;
  readonly records: ProjectRecord[];
}

export function record(path: string): ProjectRecord {
  return { path, name: path.split('\\').at(-1) ?? path, importedAt: AT };
}

export function build(records: ProjectRecord[]): Harness {
  const files = new FakeProjectFiles();
  const clock = new FakeClock(AT);
  const logger = new FakeLogger();
  const paths = new FakeProjectPaths().root(APP).root(DOCS).root(C365).root(ISG);
  // `resolveRoot` is membership, not containment — the distinction G.26 charged an hour for. A
  // fake that screened a root the way a subdirectory is screened is what let the empty-stack bug
  // ship past 1 558 green tests.
  const registry = {
    list: (): readonly ProjectRecord[] => records,
    resolveRoot: (path: string): Promise<Result<string, string>> =>
      Promise.resolve(
        records.some((held) => projectKey(held.path) === projectKey(path))
          ? ok(path)
          : err('not an imported project'),
      ),
  };
  const reader = new WorkflowMapReader({
    registry,
    paths,
    instructions: new InstructionStackReader({
      paths,
      files,
      configDirs: { '365': C365, isg: ISG },
    }),
    assets: new ClaudeAssetReader({ paths, files }),
    plugins: new PluginAssetReader({
      paths,
      files,
      assets: new ClaudeAssetReader({ paths, files }),
      configDirs: [C365, ISG],
    }),
    tickets: new ProjectTicketReader({ paths, files }),
    // The real reader over the real locator, not a fake of either — G.26's lesson, and the one
    // P3-T3 paid for again in G.27: a fake that agreed with the source would have agreed with the
    // bug too. With no `.git` in the little filesystem below it answers `[]`, which is what a
    // folder outside a repository should say.
    worktrees: new WorktreeReader({
      paths,
      roots: paths,
      locator: new GitDirectoryLocator(paths, files, logger),
      files,
      logger,
    }),
    files,
    clock,
    logger,
  });
  return { reader, files, clock, records };
}

/** `app-next`'s shape, trimmed to one of each thing the map reads. */
export function populate(files: FakeProjectFiles): void {
  const claude = childPath(APP, '.claude');
  files.file(childPath(APP, 'CLAUDE.md'), 'x'.repeat(3482));
  files.file(childPath(claude, 'soul.md'), 'y'.repeat(120));
  files.directory(claude, ['agents', 'commands', 'skills', 'settings.json', 'soul.md'], 10);
  files.file(childPath(claude, 'settings.json'), SETTINGS, 20);
  files.file(
    childPath(APP, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'chrome-devtools': {} } }),
  );
  files.directory(childPath(claude, 'agents'), ['german-ui-expert.md']);
  files.file(
    childPath(childPath(claude, 'agents'), 'german-ui-expert.md'),
    ['---', 'name: german-ui-expert', 'description: German label to source.', '---'].join('\n'),
  );
  files.directory(childPath(claude, 'rules'), ['a.md', 'b.md']);
}

export const PLUGINS = childPath(C365, 'plugins');
export const INDEX = childPath(PLUGINS, 'installed_plugins.json');
export const SUPERPOWERS = [
  PLUGINS,
  'cache',
  'claude-plugins-official',
  'superpowers',
  '6.4.1',
].reduce(childPath);

/** One user-scope plugin with one skill, and one plugin installed for a folder not imported. */
export function installPlugins(files: FakeProjectFiles, modifiedAt = 0): void {
  files.file(
    INDEX,
    JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [{ scope: 'user', installPath: SUPERPOWERS }],
        'elsewhere@claude-plugins-official': [
          { scope: 'project', projectPath: DOCS, installPath: childPath(PLUGINS, 'elsewhere') },
        ],
      },
    }),
    modifiedAt,
  );
  const skills = childPath(SUPERPOWERS, 'skills');
  files.directory(skills, ['brainstorming']);
  files.file(
    childPath(childPath(skills, 'brainstorming'), 'SKILL.md'),
    ['---', 'name: brainstorming', 'description: Before creative work.', '---'].join('\n'),
  );
}

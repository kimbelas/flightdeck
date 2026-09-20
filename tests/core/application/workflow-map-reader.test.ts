// The whole map for every imported folder, and the cache that keeps it cheap — P3-T3.
//
// Most of these cases are about the signature rather than about the reading. A map costs roughly
// thirty reads; the two stats that prove nothing has changed are what make a panel that redraws
// affordable, and the two things that MUST move it are an edit to `settings.json` and any change
// to what is in `.claude`. The TTL covers the one neither can see — a description rewritten inside
// an existing `agents/*.md`.
//
// The other half is the P3 gate, both sides of it: `app-next`'s shape reads fully, and a folder
// with no `.claude` degrades to an instruction stack and nothing else.
import { beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAssetReader } from '../../../core/application/claude-asset-reader.ts';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { InstructionStackReader } from '../../../core/application/instruction-stack-reader.ts';
import { WorkflowMapReader } from '../../../core/application/workflow-map-reader.ts';
import { WorktreeReader } from '../../../core/application/worktree-reader.ts';
import { projectKey, type ProjectRecord } from '../../../contracts/project.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const APP = 'C:\\Users\\belas\\Documents\\development\\app-next';
const DOCS = 'C:\\Users\\belas\\Documents\\development\\docs-tool';
const C365 = 'C:\\Users\\belas\\.claude-365';
const ISG = 'C:\\Users\\belas\\.claude-isg';
const AT = 1000;
const MAP_TTL = 300_000;

const SETTINGS = JSON.stringify({
  permissions: { allow: ['Bash(git status:*)'], deny: ['Read(.env)'] },
  enabledPlugins: { 'context-hygiene@claude-kit': true },
  extraKnownMarketplaces: { 'claude-kit': {} },
  hooks: { PreCompact: [{ hooks: [{ command: 'node state-dump.mjs', timeout: 15 }] }] },
});

interface Harness {
  readonly reader: WorkflowMapReader;
  readonly files: FakeProjectFiles;
  readonly clock: FakeClock;
  readonly records: ProjectRecord[];
}

let harness: Harness;

function record(path: string): ProjectRecord {
  return { path, name: path.split('\\').at(-1) ?? path, importedAt: AT };
}

function build(records: ProjectRecord[]): Harness {
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
    // The real reader over the real locator, not a fake of either — G.26's lesson, and the one
    // P3-T3 paid for again in G.27: a fake that agreed with the source would have agreed with the
    // bug too. With no `.git` in the little filesystem below it answers `[]`, which is what a
    // folder outside a repository should say.
    worktrees: new WorktreeReader({
      paths,
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
function populate(files: FakeProjectFiles): void {
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

beforeEach(() => {
  harness = build([record(APP)]);
});

describe('readAll', () => {
  it('reads every row of SPEC 5.1 for a fully configured repository', async () => {
    populate(harness.files);
    const [map] = await harness.reader.readAll();
    expect(map?.configured).toBe(true);
    expect(map?.assets.map((asset) => asset.name)).toEqual(['german-ui-expert']);
    expect(map?.hooks.map((step) => step.event)).toEqual(['PreCompact']);
    expect(map?.servers).toEqual([{ name: 'chrome-devtools', transport: 'stdio' }]);
    expect(map?.plugins).toEqual(['context-hygiene@claude-kit']);
    expect(map?.marketplaces).toEqual(['claude-kit']);
    expect(map?.permissions.allow).toEqual(['Bash(git status:*)']);
    expect(map?.conventions.find((folder) => folder.folder === 'rules')?.files).toBe(2);
  });

  it('reads the instruction stack, including both config dirs', async () => {
    populate(harness.files);
    harness.files.file(childPath(C365, 'CLAUDE.md'), 'z'.repeat(683));
    const [map] = await harness.reader.readAll();
    expect(map?.instructions.find((file) => file.source === 'claude-md')?.bytes).toBe(3482);
    expect(map?.instructions.find((file) => file.source === 'soul-md')?.bytes).toBe(120);
    expect(map?.instructions.find((file) => file.source === 'user-365')?.bytes).toBe(683);
    expect(map?.instructions.find((file) => file.source === 'agents-md')?.bytes).toBeUndefined();
  });

  it('degrades a folder with no `.claude` to its instruction stack — the P3 gate', async () => {
    harness = build([record(DOCS)]);
    harness.files.file(childPath(DOCS, 'CLAUDE.md'), 'd'.repeat(900));
    const [map] = await harness.reader.readAll();
    expect(map?.configured).toBe(false);
    expect(map?.assets).toEqual([]);
    expect(map?.hooks).toEqual([]);
    expect(map?.servers).toEqual([]);
    expect(map?.instructions.find((file) => file.source === 'claude-md')?.bytes).toBe(900);
    expect(map?.conventions).toHaveLength(6);
  });

  it('answers an empty map for a root it can no longer resolve', async () => {
    harness = build([record('C:\\Users\\belas\\Documents\\development\\unplugged')]);
    const [map] = await harness.reader.readAll();
    // Still the full shape: five sources and six folders, all absent. "No CLAUDE.md" and "I could
    // not look" already draw the same row, and a shorter list would make them differ in markup.
    expect(map?.instructions).toHaveLength(5);
    expect(map?.conventions).toHaveLength(6);
    expect(map?.configured).toBe(false);
  });

  it('survives a settings.json that is not valid JSON', async () => {
    populate(harness.files);
    harness.files.file(childPath(childPath(APP, '.claude'), 'settings.json'), '{ "hooks": ');
    const [map] = await harness.reader.readAll();
    // Mid-edit, or a merge conflict left in the file. A panel is not where a malformed config gets
    // reported — and the rest of the map is still readable.
    expect(map?.hooks).toEqual([]);
    expect(map?.assets).toHaveLength(1);
  });
});

describe('the cache', () => {
  it('does not re-read when neither mtime has moved', async () => {
    populate(harness.files);
    await harness.reader.readAll();
    const after = harness.files.listed.length;
    await harness.reader.readAll();
    expect(harness.files.listed).toHaveLength(after);
  });

  it('re-reads when settings.json is edited', async () => {
    populate(harness.files);
    await harness.reader.readAll();
    const after = harness.files.listed.length;
    harness.files.touch(childPath(childPath(APP, '.claude'), 'settings.json'), 99);
    await harness.reader.readAll();
    expect(harness.files.listed.length).toBeGreaterThan(after);
  });

  it('re-reads when an agent is added, which moves the directory mtime', async () => {
    populate(harness.files);
    await harness.reader.readAll();
    const after = harness.files.listed.length;
    harness.files.touch(childPath(APP, '.claude'), 77);
    await harness.reader.readAll();
    expect(harness.files.listed.length).toBeGreaterThan(after);
  });

  it('re-reads once the TTL lapses, for the edit no stat can see', async () => {
    // A description rewritten inside an existing `agents/*.md` moves neither mtime.
    populate(harness.files);
    await harness.reader.readAll();
    const after = harness.files.listed.length;
    harness.clock.advance(MAP_TTL + 1);
    await harness.reader.readAll();
    expect(harness.files.listed.length).toBeGreaterThan(after);
  });

  it('forgets a project the registry no longer holds', async () => {
    populate(harness.files);
    await harness.reader.readAll();
    harness.records.length = 0;
    expect(await harness.reader.readAll()).toEqual([]);
    // Re-imported, the map is read afresh rather than answered from a cache filled while the
    // owner still had permission to read it (SEC-FS-1).
    harness.records.push(record(APP));
    const after = harness.files.listed.length;
    await harness.reader.readAll();
    expect(harness.files.listed.length).toBeGreaterThan(after);
  });
});

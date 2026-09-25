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
import { childPath } from '../../../contracts/windows-path.ts';
import {
  APP,
  C365,
  DOCS,
  MAP_TTL,
  build,
  installPlugins,
  populate,
  record,
  type Harness,
} from './workflow-map-harness.ts';

let harness: Harness;

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

  it("appends the installed plugins' assets, each carrying its plugin (P9-T5)", async () => {
    populate(harness.files);
    installPlugins(harness.files);
    const [map] = await harness.reader.readAll();
    expect(map?.assets.map((asset) => [asset.name, asset.plugin])).toEqual([
      ['german-ui-expert', undefined],
      ['brainstorming', 'superpowers'],
    ]);
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

  it('re-reads when a spec is written for a new ticket, which moves only specs/', async () => {
    // P9-T3. `.claude`'s own mtime does not move when a folder is added two levels down.
    populate(harness.files);
    const specs = childPath(childPath(APP, '.claude'), 'specs');
    harness.files.directory(specs, [], 5);
    expect((await harness.reader.readAll())[0]?.tickets).toEqual([]);
    harness.files.directory(specs, ['XWEB-2126'], 66);
    harness.files.directory(childPath(specs, 'XWEB-2126'), [], 66);
    expect((await harness.reader.readAll())[0]?.tickets).toEqual(['XWEB-2126']);
  });

  it('re-reads when a state note is written, which moves only state/', async () => {
    populate(harness.files);
    const state = childPath(childPath(APP, '.claude'), 'state');
    harness.files.directory(state, [], 5);
    await harness.reader.readAll();
    harness.files.directory(state, ['XWEB-1830.md'], 67);
    harness.files.file(childPath(state, 'XWEB-1830.md'), 'notes', 67);
    expect((await harness.reader.readAll())[0]?.tickets).toEqual(['XWEB-1830']);
  });

  it('re-reads when a plugin is installed, which moves only the index (P9-T5)', async () => {
    populate(harness.files);
    await harness.reader.readAll();
    installPlugins(harness.files, 88);
    expect((await harness.reader.readAll())[0]?.assets).toHaveLength(2);
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

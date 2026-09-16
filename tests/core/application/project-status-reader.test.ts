// Stack and git for every imported folder — P3-T2, SPEC §5.1.
//
// Two lifetimes in one class, and most of these cases are about the difference. Git is signed by
// `.git`'s mtimes and expires in four seconds because somebody commits; a stack is five filenames
// and expires in five minutes because somebody adds a `Dockerfile` about once a year. A single TTL
// for both would either re-list every project root four times a second or show a branch from five
// minutes ago.
import { beforeEach, describe, expect, it } from 'vitest';
import { GitDirectoryLocator } from '../../../core/application/git-directory-locator.ts';
import { ProjectGitReader } from '../../../core/application/project-git-reader.ts';
import { ProjectStatusReader } from '../../../core/application/project-status-reader.ts';
import { projectKey, type ProjectRecord } from '../../../contracts/project.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const APP = 'C:\\Users\\belas\\Documents\\development\\app-next';
const DOCS = 'C:\\Users\\belas\\Documents\\development\\docs-tool';
const AT = 1000;
const STACK_TTL = 300_000;

const PORCELAIN = '# branch.head main\n# branch.ab +0 -0\n';

/** The registry, narrowed to the one method the reader uses. */
class HeldProjects {
  private readonly records: ProjectRecord[];

  constructor(records: ProjectRecord[]) {
    this.records = records;
  }

  public list(): readonly ProjectRecord[] {
    return this.records;
  }

  public forget(path: string): void {
    const at = this.records.findIndex((held) => held.path === path);
    if (at >= 0) this.records.splice(at, 1);
  }

  public remember(held: ProjectRecord): void {
    this.records.push(held);
  }
}

interface Harness {
  readonly reader: ProjectStatusReader;
  readonly held: HeldProjects;
  readonly files: FakeProjectFiles;
  readonly clock: FakeClock;
  readonly logger: FakeLogger;
  readonly listings: () => number;
}

let harness: Harness;

function record(path: string): ProjectRecord {
  return { path, name: path.split('\\').at(-1) ?? path, importedAt: AT };
}

function build(paths: FakeProjectPaths, records: ProjectRecord[]): Harness {
  const files = new FakeProjectFiles();
  const clock = new FakeClock(AT);
  const logger = new FakeLogger();
  const runner = new FakeProcessRunner();
  runner.willReturn({ stdout: PORCELAIN });
  const held = new HeldProjects(records);
  // `resolveRoot`, not `resolve`: the root of a project is a DIRECTORY, and `ReadPolicy` refuses
  // one outright. A fake that answered the root through the file rule is exactly what let the
  // empty-stack bug ship green (RESEARCH.md G.26), so this one goes through the registry's own
  // membership check — canonicalise first, then ask whether that folder is still imported.
  const registry = {
    list: () => held.list(),
    resolveRoot: async (path: string): Promise<Result<string, string>> => {
      const resolved = await paths.resolve(childPath(path, '.'));
      if (!resolved.ok) return err('not an imported project');
      return held.list().some((project) => projectKey(project.path) === projectKey(path))
        ? ok(path)
        : err('not an imported project');
    },
  };
  const reader = new ProjectStatusReader({
    registry,
    git: new ProjectGitReader({
      paths,
      locator: new GitDirectoryLocator(paths, files, logger),
      files,
      runner,
      clock,
      logger,
    }),
    files,
    clock,
    logger,
  });
  return { reader, held, files, clock, logger, listings: () => files.listed.length };
}

beforeEach(() => {
  harness = build(new FakeProjectPaths().root(APP).root(DOCS), [record(APP), record(DOCS)]);
  harness.files.directory(APP, ['package.json', 'next.config.ts', 'src']);
  harness.files.directory(DOCS, ['README.md', 'docs']);
});

describe('ProjectStatusReader', () => {
  it('answers one reading per imported project, in the registry order', async () => {
    const statuses = await harness.reader.readAll();
    expect(statuses.map((status) => status.path)).toEqual([APP, DOCS]);
  });

  it('answers nothing at all on a machine that has imported nothing', async () => {
    // The registry ships empty (D26) and nothing here scans to fill it in.
    const empty = build(new FakeProjectPaths(), []);
    expect(await empty.reader.readAll()).toEqual([]);
  });

  it('detects the stack from one listing of the project root', async () => {
    const [app] = await harness.reader.readAll();
    expect(app?.stack).toEqual(['Next.js', 'Node']);
  });

  it('degrades gracefully for a folder with no marker and no repository', async () => {
    // SPEC §5.1's second half: a docs repository with no `.claude` still gets a row, with empty
    // fields rather than an error.
    const [, docs] = await harness.reader.readAll();
    expect(docs).toMatchObject({ path: DOCS, stack: [], git: undefined });
  });

  it('holds the stack for five minutes rather than re-listing on every request', async () => {
    await harness.reader.readAll();
    await harness.reader.readAll();
    expect(harness.listings()).toBe(2);
  });

  it('re-lists once the stack TTL lapses, so a new Dockerfile eventually shows', async () => {
    await harness.reader.readAll();
    harness.clock.advance(STACK_TTL + 1);
    await harness.reader.readAll();
    expect(harness.listings()).toBe(4);
  });

  it('carries the git reading beside the stack', async () => {
    harness.files.directory(`${APP}\\.git`, ['HEAD', 'index']);
    const [app] = await harness.reader.readAll();
    expect(app?.git).toMatchObject({ branch: 'main', dirty: 0 });
  });

  it('timestamps each reading from the clock rather than from the request', async () => {
    harness.clock.advance(500);
    const [app] = await harness.reader.readAll();
    expect(app?.at).toBe(AT + 500);
  });

  it('answers an empty stack for a root that can no longer be resolved, and logs it', async () => {
    // Unplugged, renamed, or a junction that now points somewhere it may not. The registry still
    // holds it, and nothing else on the machine would ever say so.
    const gone = build(new FakeProjectPaths(), [record(APP)]);
    const [status] = await gone.reader.readAll();
    expect(status?.stack).toEqual([]);
    expect(gone.logger.logged('project_root_unreadable')).toBe(true);
  });

  it('forgets a withdrawn project\u2019s reading rather than answering from it after a re-import', async () => {
    // A cache that outlived the permission would be a folder still being reported on after the
    // owner revoked read access to it, and then reported on from BEFORE the revocation when they
    // changed their mind (SEC-FS-1). The stack TTL is five minutes, so without eviction the
    // re-import below would be answered from the entry filled two lines earlier.
    await harness.reader.readAll();
    harness.held.forget(DOCS);
    await harness.reader.readAll();
    const listedBefore = harness.listings();
    harness.held.remember(record(DOCS));
    await harness.reader.readAll();
    expect(harness.listings()).toBe(listedBefore + 1);
  });
});

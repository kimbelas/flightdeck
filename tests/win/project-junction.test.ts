// SEC-FS-1's fourth check, on the filesystem that has to answer it — P3-T1.
//
// The rule is "reject a path that resolves through a junction outside the root", and every layer
// above this one takes it on trust: `ReadPolicy` compares strings and cannot see a link at all,
// `FakePathCanonicaliser` resolves one because it was told to, and `ProjectRegistry.resolve`
// composes the two. What none of them establishes is that **Windows behaves this way** — so this
// file makes a real junction with `mklink /J` and asks.
//
// **A junction is not a symbolic link, which is the whole reason this is a `tests/win/` file.** It
// needs no privilege to create, Explorer shows it as an ordinary folder, and it is the shape a
// Windows developer's tree actually grows: `node_modules` redirections, `.claude\worktrees`, a
// "shortcut" to a config directory. The lesson `transcript-identity.test.ts` learned applies here
// too — an assertion about a filesystem belongs in the suite that runs on `windows-latest`, not in
// a weakened version of it that runs everywhere and proves less.
//
// **What it measures, on Node 26.3.0:** `fsPromises.realpath` resolves a junction to its target
// and folds a mis-cased directory back to the casing on disk. Both are things `FsPathCanonicaliser`
// depends on and neither is written down anywhere else.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../core/application/audit-log.ts';
import { ProjectRegistry } from '../../core/application/project-registry.ts';
import { FsPathCanonicaliser } from '../../core/adapters/node/fs-path-canonicaliser.ts';
import { FakeClock } from '../fakes/fake-clock.ts';
import { FakeLogger } from '../fakes/fake-logger.ts';
import { FakeStore } from '../fakes/fake-store.ts';

const onWindows = process.platform === 'win32';

let root = '';
let project = '';
let outside = '';
let configDir = '';

/**
 * `cmd /c mklink /J` — the only way to make one, and `mklink` is a shell builtin rather than an
 * executable, so `cmd` is the program being run with an argument array (SEC-PROC-1: no `exec`, no
 * `shell: true`, nothing interpolated — the paths are `mkdtemp` output in this test's own folder).
 */
function junction(link: string, target: string): void {
  execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' });
}

function blank(): ProjectRegistry {
  const store = new FakeStore();
  const clock = new FakeClock();
  const logger = new FakeLogger();
  return new ProjectRegistry({
    store,
    paths: new FsPathCanonicaliser(),
    configDirs: [configDir],
    audit: new AuditLog(store, clock, logger),
    clock,
    logger,
  });
}

/** A registry with one project already imported — awaited, or every `resolve` below races it. */
async function registry(projectRoot: string): Promise<ProjectRegistry> {
  const built = blank();
  await built.import(projectRoot);
  return built;
}

beforeEach(() => {
  if (!onWindows) return;
  // Resolved immediately: `%TEMP%` can itself be reached through a link, and a test whose root is
  // one spelling while `realpath` answers with another fails for a reason that is not the rule.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'fd-junction-')));
  project = join(root, 'app-next');
  outside = join(root, 'elsewhere');
  configDir = join(root, '.claude-365');
  for (const directory of [project, outside, configDir]) mkdirSync(directory);
  writeFileSync(join(project, 'CLAUDE.md'), '# project\n', 'utf8');
  writeFileSync(join(outside, 'secret.txt'), 'not yours\n', 'utf8');
  mkdirSync(join(configDir, 'daemon'));
  writeFileSync(join(configDir, 'daemon', 'control.key'), 'deadbeef\n', 'utf8');
});

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('realpath on NTFS, which is what SEC-FS-1 rests on', () => {
  it.skipIf(!onWindows)('resolves a junction to its target', async () => {
    junction(join(project, 'escape'), outside);

    const resolved = await new FsPathCanonicaliser().canonicalise(
      join(project, 'escape', 'secret.txt'),
    );

    // If this ever stops being true, every check below is decoration and the import path is blind.
    expect(resolved?.path).toBe(join(outside, 'secret.txt'));
  });

  it.skipIf(!onWindows)('folds a mis-cased directory back to the casing on disk', async () => {
    const resolved = await new FsPathCanonicaliser().canonicalise(project.toUpperCase());

    expect(resolved?.path).toBe(project);
    expect(resolved?.isDirectory).toBe(true);
  });

  it.skipIf(!onWindows)(
    'says a file is not a directory, and a missing path is nothing',
    async () => {
      const paths = new FsPathCanonicaliser();

      expect((await paths.canonicalise(join(project, 'CLAUDE.md')))?.isDirectory).toBe(false);
      expect(await paths.canonicalise(join(project, 'nowhere.md'))).toBeUndefined();
    },
  );
});

describe('ProjectRegistry.resolve against a real junction', () => {
  it.skipIf(!onWindows)('allows an ordinary file inside the imported root', async () => {
    const wanted = join(project, 'CLAUDE.md');
    const registered = await registry(project);

    expect(await registered.resolve(wanted)).toEqual({ ok: true, value: wanted });
  });

  it.skipIf(!onWindows)('refuses a path that leaves the root through a junction', async () => {
    // The check no string rule can make: the path is squarely inside the project, and the bytes it
    // would open are not.
    junction(join(project, 'escape'), outside);
    const registered = await registry(project);

    const refused = await registered.resolve(join(project, 'escape', 'secret.txt'));

    expect(refused.ok).toBe(false);
  });

  it.skipIf(!onWindows)('refuses a junction that lands in a config directory', async () => {
    // The one that would matter: a link in a repository pointing at `~/.claude-365`, which is how
    // a project root would otherwise become a way to read `control.key` (SEC-FS-2).
    junction(join(project, 'cfg'), configDir);
    const registered = await registry(project);

    const refused = await registered.resolve(join(project, 'cfg', 'daemon', 'control.key'));

    expect(refused.ok ? '' : refused.error).toContain('SEC-FS-2');
  });

  it.skipIf(!onWindows)('refuses a `..` that climbs out of the root', async () => {
    const climbed = join(project, '..', 'elsewhere', 'secret.txt');
    const registered = await registry(project);

    // `realpath` collapses the `..` itself, so what makes this a refusal is the resolved path
    // being outside the root rather than the segment being spotted — both halves of the same rule.
    expect((await registered.resolve(climbed)).ok).toBe(false);
  });

  it.skipIf(!onWindows)('imports the target when the ROOT itself is a junction', async () => {
    // Importing a link imports what it points at, which is what makes `config_directory` and every
    // later comparison work on one string rather than two.
    junction(join(root, 'shortcut'), project);

    const registered = await registry(join(root, 'shortcut'));

    expect(registered.list().map((held) => held.path)).toEqual([project]);
  });

  it.skipIf(!onWindows)('refuses to import a junction pointing at a config directory', async () => {
    junction(join(root, 'sneaky'), configDir);

    expect(await blank().import(join(root, 'sneaky'))).toEqual({
      ok: false,
      error: 'config_directory',
    });
  });
});

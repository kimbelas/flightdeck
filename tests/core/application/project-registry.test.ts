// The registry — P3-T1, SEC-FS-1, DECISIONS.md D26.
//
// Two things here are worth more than the rest. The first case asserts that a fresh registry is
// EMPTY, which is the whole of D26 in one line and the assertion a future "helpful" scan would
// have to delete. And `resolve` is where SEC-FS-1's four checks finally compose — the junction
// case is expressible against the fake, and `tests/win/project-junction.test.ts` proves NTFS
// actually behaves the way the fake pretends.
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { ProjectRegistry } from '../../../core/application/project-registry.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakePathCanonicaliser } from '../../fakes/fake-path-canonicaliser.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const CFG = 'C:\\Users\\belas\\.claude-365';
const ISG = 'C:\\Users\\belas\\.claude-isg';
const APP_NEXT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const DOCS_TOOL = 'C:\\Users\\belas\\Documents\\development\\docs-tool';
const AT = 1_700_000_000_000;

interface Harness {
  readonly registry: ProjectRegistry;
  readonly store: FakeStore;
  readonly paths: FakePathCanonicaliser;
  readonly clock: FakeClock;
  readonly logger: FakeLogger;
}

let harness: Harness;

function build(store = new FakeStore()): Harness {
  // The two folders and one file in each, so a `resolve` case fails on the POLICY rather than on
  // the fake not having heard of the path — which is a green test that proves nothing.
  const paths = new FakePathCanonicaliser()
    .directory(APP_NEXT)
    .directory(DOCS_TOOL)
    .file(`${APP_NEXT}\\CLAUDE.md`)
    .file(`${DOCS_TOOL}\\CLAUDE.md`);
  const clock = new FakeClock(AT);
  const logger = new FakeLogger();
  const registry = new ProjectRegistry({
    store,
    paths,
    configDirs: [CFG, ISG],
    audit: new AuditLog(store, clock, logger),
    clock,
    logger,
  });
  return { registry, store, paths, clock, logger };
}

beforeEach(() => {
  harness = build();
});

describe('ProjectRegistry — what it ships with', () => {
  it('is empty, and nothing scans the disk to fill it (D26)', () => {
    // The task's first rule. A compiled-in list, or a walk of `~/Documents`, would make SEC-FS-1's
    // allowlist something nobody can read back — it grows by one deliberate act at a time.
    expect(harness.registry.list()).toEqual([]);
  });

  it('allows nothing outside the config directories until something is imported', async () => {
    const resolved = await harness.registry.resolve(`${APP_NEXT}\\CLAUDE.md`);

    expect(resolved.ok).toBe(false);
  });

  it('loads what a previous boot imported', async () => {
    await harness.registry.import(APP_NEXT);

    // A second registry over the same store: the roots are a security input and have to exist
    // before a route can be reached, so they are read at construction rather than on first use.
    expect(
      build(harness.store)
        .registry.list()
        .map((project) => project.path),
    ).toEqual([APP_NEXT]);
  });
});

describe('ProjectRegistry — importing', () => {
  it('stores the canonical path, a derived name and the time it was imported', async () => {
    const imported = await harness.registry.import(APP_NEXT);

    expect(imported).toEqual({
      ok: true,
      value: { path: APP_NEXT, name: 'app-next', importedAt: AT },
    });
  });

  it('imports the path the FILESYSTEM means, not the one that was typed', async () => {
    harness.paths.directory('C:\\dev\\link', APP_NEXT);

    const imported = await harness.registry.import('C:\\dev\\link');

    expect(imported.ok && imported.value.path).toBe(APP_NEXT);
  });

  it('widens what may be read, and by exactly one folder', async () => {
    await harness.registry.import(APP_NEXT);

    expect(await harness.registry.resolve(`${APP_NEXT}\\CLAUDE.md`)).toEqual({
      ok: true,
      value: `${APP_NEXT}\\CLAUDE.md`,
    });
    expect((await harness.registry.resolve(`${DOCS_TOOL}\\CLAUDE.md`)).ok).toBe(false);
  });

  it('is idempotent, and keeps the time of the FIRST import', async () => {
    // "When did I add this" is a fact about the decision. A second click on the same folder is not
    // a second decision, and it must not become a second row.
    await harness.registry.import(APP_NEXT);
    harness.clock.advance(60_000);

    const again = await harness.registry.import(`${APP_NEXT.toLowerCase()}\\`);

    expect(again.ok && again.value.importedAt).toBe(AT);
    expect(harness.registry.list()).toHaveLength(1);
  });

  it('writes an audit row for a taken import', async () => {
    await harness.registry.import(APP_NEXT);

    expect(harness.store.allAudit.map((row) => [row.action, row.target, row.outcome])).toEqual([
      ['project.import', APP_NEXT, 'ok'],
    ]);
  });

  it('keeps the newest import first', async () => {
    await harness.registry.import(APP_NEXT);
    harness.clock.advance(1000);
    await harness.registry.import(DOCS_TOOL);

    expect(harness.registry.list().map((project) => project.name)).toEqual([
      'docs-tool',
      'app-next',
    ]);
  });
});

describe('ProjectRegistry — refusing', () => {
  it('refuses a folder that is not there', async () => {
    expect(await harness.registry.import('Z:\\nothing\\here')).toEqual({
      ok: false,
      error: 'missing',
    });
  });

  it('refuses a file', async () => {
    harness.paths.file('C:\\Users\\belas\\notes.md');

    expect(await harness.registry.import('C:\\Users\\belas\\notes.md')).toEqual({
      ok: false,
      error: 'not_a_directory',
    });
  });

  it('refuses a config directory, and one reached through a junction', async () => {
    harness.paths.directory(CFG).junction('C:\\dev\\shortcut', CFG);

    expect((await harness.registry.import(CFG)).ok).toBe(false);
    // The interesting half: the typed path is innocent and the resolved one is not, which is why
    // the second screen runs on what `realpath` returned.
    expect(await harness.registry.import('C:\\dev\\shortcut')).toEqual({
      ok: false,
      error: 'config_directory',
    });
  });

  it('refuses a traversal without asking the filesystem anything', async () => {
    // The lexical screen runs first so a request nobody should act on never becomes a syscall.
    expect(await harness.registry.import('C:\\Users\\belas\\..\\..\\Windows')).toEqual({
      ok: false,
      error: 'traversal',
    });
  });

  it('writes an audit row for a refused import too', async () => {
    await harness.registry.import('');

    expect(harness.store.auditFailures().map((row) => [row.outcome, row.reason])).toEqual([
      ['refused', 'empty'],
    ]);
  });

  it('caps what a refusal puts in the audit log', async () => {
    // `too_long` is refused precisely because the request was enormous; a row that recorded all of
    // it would let one bad request push 64 KB into the audit log.
    await harness.registry.import(`C:\\${'a'.repeat(50_000)}`);

    expect(harness.store.allAudit[0]?.target.length).toBeLessThanOrEqual(1024);
  });

  it('imports nothing when it refuses', async () => {
    await harness.registry.import('');
    await harness.registry.import('Z:\\nothing');

    expect(harness.registry.list()).toEqual([]);
  });
});

describe('ProjectRegistry — forgetting', () => {
  it('takes the permission away, not just the row', async () => {
    await harness.registry.import(APP_NEXT);

    expect(harness.registry.forget(APP_NEXT)).toBe(true);
    expect(harness.registry.list()).toEqual([]);
    expect((await harness.registry.resolve(`${APP_NEXT}\\CLAUDE.md`)).ok).toBe(false);
  });

  it('matches the folder however the path is spelled', async () => {
    await harness.registry.import(APP_NEXT);

    expect(harness.registry.forget(APP_NEXT.replaceAll('\\', '/').toUpperCase())).toBe(true);
  });

  it('says so when there was nothing to forget, and records it', () => {
    expect(harness.registry.forget(DOCS_TOOL)).toBe(false);
    expect(harness.store.auditFailures().map((row) => [row.action, row.reason])).toEqual([
      ['project.forget', 'not imported'],
    ]);
  });
});

describe('ProjectRegistry — resolve, which is SEC-FS-1 composed', () => {
  beforeEach(async () => {
    await harness.registry.import(APP_NEXT);
  });

  it('refuses a junction that leads out of the root', async () => {
    // The check no string rule can make. On Windows a junction is not a symlink, `ReadPolicy` is
    // pure string work, and the lexical path is squarely inside the project — so resolving first
    // and screening the RESOLVED path is the only order that sees it.
    harness.paths.junction(`${APP_NEXT}\\escape`, `${CFG}\\daemon`);

    expect((await harness.registry.resolve(`${APP_NEXT}\\escape`)).ok).toBe(false);
  });

  it('screens what a junction LANDS on by the rules of where it landed', async () => {
    // Not by the project rules, which would have allowed this `.json` happily. The resolved path
    // is under a config directory, so SEC-FS-2's unlisted-`.json` rule is the one that applies —
    // which is the ordering `ReadPolicy` promises, and the reason a junction cannot launder a path
    // into a laxer rule set.
    harness.paths.file(`${APP_NEXT}\\cfg`, `${CFG}\\statsig\\x.json`);

    const resolved = await harness.registry.resolve(`${APP_NEXT}\\cfg`);

    expect(resolved.ok ? '' : resolved.error).toContain('SEC-FS-2');
  });

  it('refuses a path that resolves to nothing', async () => {
    expect(await harness.registry.resolve(`${APP_NEXT}\\gone.md`)).toEqual({
      ok: false,
      error: 'no such path',
    });
  });

  it('says why, in ReadPolicy\u2019s own words, and logs it', async () => {
    harness.paths.file(`${APP_NEXT}\\id.key`);

    const resolved = await harness.registry.resolve(`${APP_NEXT}\\id.key`);

    expect(resolved.ok ? '' : resolved.error).toContain('SEC-FS-2');
    expect(harness.logger.logged('project_path_refused')).toBe(true);
  });

  it('still refuses everything under a config directory', async () => {
    harness.paths.file(`${CFG}\\daemon\\control.key`);

    expect((await harness.registry.resolve(`${CFG}\\daemon\\control.key`)).ok).toBe(false);
  });
});

describe('ProjectRegistry.resolveRoot', () => {
  // The method `resolve` could not be made to answer, and the bug that proved it. `ReadPolicy`
  // decides whether core may OPEN a file and refuses a directory outright — "the project directory
  // itself is not a file" — which is correct for what it is asked. Listing a root is a different
  // question, and asking the wrong one shipped past a green unit suite and a green deck smoke with
  // every imported project reporting an empty stack (P3-T2, RESEARCH.md G.26).

  it('answers the canonical directory for a folder that is imported', async () => {
    await harness.registry.import(APP_NEXT);

    expect(await harness.registry.resolveRoot(APP_NEXT)).toEqual({ ok: true, value: APP_NEXT });
  });

  it('answers where `resolve` refuses, which is the whole reason it exists', async () => {
    await harness.registry.import(APP_NEXT);

    // Both are right about their own question. Only one of them is about listing a folder.
    expect((await harness.registry.resolve(APP_NEXT)).ok).toBe(false);
    expect((await harness.registry.resolveRoot(APP_NEXT)).ok).toBe(true);
  });

  it('refuses a folder that was never imported', async () => {
    expect(await harness.registry.resolveRoot(DOCS_TOOL)).toEqual({
      ok: false,
      error: 'not an imported project',
    });
  });

  it('refuses one that has been forgotten, so permission really is withdrawn', async () => {
    await harness.registry.import(APP_NEXT);
    harness.registry.forget(APP_NEXT);

    expect((await harness.registry.resolveRoot(APP_NEXT)).ok).toBe(false);
  });

  it('refuses a file, because a file is not a root to list', async () => {
    await harness.registry.import(APP_NEXT);

    expect(await harness.registry.resolveRoot(`${APP_NEXT}\\CLAUDE.md`)).toEqual({
      ok: false,
      error: 'not a directory',
    });
  });

  it('refuses a path that resolves to nothing', async () => {
    expect(await harness.registry.resolveRoot('Z:\\gone')).toEqual({
      ok: false,
      error: 'no such path',
    });
  });

  it('matches two spellings of one folder, because a root is a path and casing is not identity', async () => {
    await harness.registry.import(APP_NEXT);

    expect((await harness.registry.resolveRoot(APP_NEXT.toUpperCase())).ok).toBe(true);
  });

  it('refuses a root replaced by a junction to somewhere that was never imported', async () => {
    // SEC-FS-1's fourth check, in the one shape this method can meet it: the stored string is
    // canonicalised FIRST, so what is checked against the registry is where the folder now points
    // rather than what it was called when it was imported.
    await harness.registry.import(APP_NEXT);
    const swapped = build(harness.store);
    swapped.paths.junction(APP_NEXT, 'C:\\Users\\belas\\.claude-365');

    const resolved = await swapped.registry.resolveRoot(APP_NEXT);

    expect(resolved).toEqual({ ok: false, error: 'not an imported project' });
    expect(swapped.logger.logged('project_root_refused')).toBe(true);
  });
});

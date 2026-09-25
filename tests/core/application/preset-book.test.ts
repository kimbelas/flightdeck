// The presets a project has, and the two ways that list changes — P4-T1.
//
// Two groups of cases carry the weight. **The merge**: built-ins are computed for every imported
// folder and a saved preset SHADOWS the one with its id rather than sitting beside it, which is
// the whole reason "customise the ticket preset" is one save and not a second button. **The two
// screens on `cwd`**: a preset names a folder a session will be started in, so it must be a
// directory inside an imported project AND inside the project it is filed under — without the
// second check a preset filed under `app-next` could start a session in `docs-tool`.
import { beforeEach, describe, expect, it } from 'vitest';
import { presetPrompt, type PresetDraft } from '../../../contracts/launch-preset.ts';
import { projectKey } from '../../../contracts/project.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { PresetBook } from '../../../core/application/preset-book.ts';
import { ProjectRegistry } from '../../../core/application/project-registry.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakePathCanonicaliser } from '../../fakes/fake-path-canonicaliser.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const CFG = 'C:\\Users\\belas\\.claude-365';
const ISG = 'C:\\Users\\belas\\.claude-isg';
const APP_NEXT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const TREE = `${APP_NEXT}\\.claude\\worktrees\\XWEB-2019`;
const DOCS_TOOL = 'C:\\Users\\belas\\Documents\\development\\docs-tool';
const OUTSIDE = 'C:\\Windows\\System32';

interface Harness {
  readonly book: PresetBook;
  readonly registry: ProjectRegistry;
  readonly store: FakeStore;
}

let harness: Harness;

function build(): Harness {
  const store = new FakeStore();
  const paths = new FakePathCanonicaliser()
    .directory(APP_NEXT)
    .directory(TREE)
    .directory(DOCS_TOOL)
    .directory(OUTSIDE);
  const clock = new FakeClock(1_700_000_000_000);
  const logger = new FakeLogger();
  const audit = new AuditLog(store, clock, logger);
  const registry = new ProjectRegistry({
    store,
    paths,
    configDirs: [CFG, ISG],
    audit,
    clock,
    logger,
  });
  // P9-T1. `app-next` has one agent on its roster; every other folder has none.
  const roster = {
    namesFor: (path: string): Promise<readonly string[]> =>
      Promise.resolve(projectKey(path) === projectKey(APP_NEXT) ? ['code-reviewer'] : []),
  };
  return { book: new PresetBook({ registry, roster, store, audit, logger }), registry, store };
}

function draft(over: Partial<PresetDraft> = {}): PresetDraft {
  return {
    projectPath: APP_NEXT,
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: '',
    sessionName: 'XWEB-2019',
    promptSource: 'ticket',
    prompt: '',
    group: undefined,
    agent: undefined,
    ...over,
  };
}

beforeEach(async () => {
  harness = build();
  await harness.registry.import(APP_NEXT);
});

describe('PresetBook — the list', () => {
  it('is empty on a machine that has imported nothing', () => {
    // A fresh book over a fresh registry — D26's "ships empty" one layer up.
    expect(build().book.list()).toEqual([]);
  });

  it('gives every imported folder its four built-ins without storing anything', () => {
    expect(harness.book.list().map((held) => held.id)).toEqual([
      '365',
      'isg',
      'orchestrator',
      'ticket',
    ]);
    // Ordered by name (`byProjectThenName`), and nothing was written to do it.
    expect(harness.store.savedPresets()).toEqual([]);
  });

  it('shadows a built-in with a saved preset of the same name rather than listing both', async () => {
    await harness.book.save(draft({ cwd: TREE }));

    const tickets = harness.book.list().filter((held) => held.id === 'ticket');

    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.builtIn).toBe(false);
    expect(tickets[0]?.cwd).toBe(TREE);
  });

  it('lists a saved preset beside the built-ins when its name is a new one', async () => {
    await harness.book.save(draft({ name: 'nightly', promptSource: 'literal', prompt: 'go' }));

    expect(harness.book.list().map((held) => held.id)).toEqual([
      '365',
      'isg',
      'nightly',
      'orchestrator',
      'ticket',
    ]);
  });

  it('drops a saved preset whose project is no longer imported', async () => {
    await harness.book.save(draft({ name: 'nightly', promptSource: 'literal', prompt: 'go' }));
    // Reaching past the cascade on purpose: `list` must not TRUST that the delete happened, which
    // is the belt to the store's braces.
    harness.store.savePreset({
      projectKey: projectKey(DOCS_TOOL),
      id: 'ghost',
      name: 'ghost',
      profileFn: 'claude-365',
      cwd: DOCS_TOOL,
      sessionName: 'ghost',
      promptSource: 'literal',
      prompt: 'go',
      group: undefined,
      agent: undefined,
      builtIn: false,
    });

    expect(harness.book.list().map((held) => held.id)).not.toContain('ghost');
  });

  it('computes the ticket preset’s prompt from what it was saved with', async () => {
    await harness.book.save(draft({ sessionName: 'XWEB-77' }));

    const ticket = harness.book.list().find((held) => held.id === 'ticket');

    expect(ticket === undefined ? '' : presetPrompt(ticket)).toContain('plan ticket XWEB-77');
  });
});

describe('PresetBook — saving', () => {
  it('stores it under the project, with the id derived from the name', async () => {
    const saved = await harness.book.save(draft({ name: 'Morning triage' }));

    expect(saved.ok && saved.value.id).toBe('morning-triage');
    expect(saved.ok && saved.value.projectKey).toBe(projectKey(APP_NEXT));
  });

  it('defaults the folder to the project root, which is what an empty box means', async () => {
    const saved = await harness.book.save(draft({ cwd: '' }));

    expect(saved.ok && saved.value.cwd).toBe(APP_NEXT);
  });

  it('accepts a worktree under the project', async () => {
    const saved = await harness.book.save(draft({ cwd: TREE }));

    expect(saved.ok && saved.value.cwd).toBe(TREE);
  });

  it('refuses a folder inside a DIFFERENT imported project', async () => {
    await harness.registry.import(DOCS_TOOL);

    const saved = await harness.book.save(draft({ cwd: DOCS_TOOL }));

    expect(saved.ok).toBe(false);
    expect(!saved.ok && saved.error).toBe('bad_cwd');
  });

  it('refuses a folder outside every imported project', async () => {
    const saved = await harness.book.save(draft({ cwd: OUTSIDE }));

    expect(!saved.ok && saved.error).toBe('bad_cwd');
  });

  it('refuses a folder nothing on disk answers for', async () => {
    const saved = await harness.book.save(draft({ cwd: `${APP_NEXT}\\nope` }));

    expect(!saved.ok && saved.error).toBe('bad_cwd');
  });

  it('refuses a project that is not imported', async () => {
    const saved = await harness.book.save(draft({ projectPath: DOCS_TOOL }));

    expect(!saved.ok && saved.error).toBe('unknown_project');
  });

  it('refuses a name that reduces to no id', async () => {
    const saved = await harness.book.save(draft({ name: '***' }));

    expect(!saved.ok && saved.error).toBe('bad_name');
  });

  it('replaces rather than duplicating when the same name is saved twice', async () => {
    await harness.book.save(draft({ sessionName: 'XWEB-1' }));
    await harness.book.save(draft({ sessionName: 'XWEB-2' }));

    expect(harness.store.savedPresets()).toHaveLength(1);
    expect(harness.store.savedPresets()[0]?.sessionName).toBe('XWEB-2');
  });

  it('stops at the cap, and still lets an existing one be edited', async () => {
    for (let index = 0; index < 24; index += 1) {
      await harness.book.save(draft({ name: `preset-${String(index)}` }));
    }

    const another = await harness.book.save(draft({ name: 'one-too-many' }));
    const edit = await harness.book.save(draft({ name: 'preset-0', sessionName: 'XWEB-9' }));

    expect(!another.ok && another.error).toBe('too_many');
    expect(edit.ok).toBe(true);
  });

  it('audits the save with the profile function and never the prompt', async () => {
    await harness.book.save(draft({ promptSource: 'literal', prompt: 'my own words' }));

    const row = harness.store.allAudit.find((held) => held.action === 'preset.save');

    expect(row?.outcome).toBe('ok');
    expect(row?.args).toEqual(['claude-isg-ticket']);
    expect(JSON.stringify(row)).not.toContain('my own words');
  });

  it('audits a refusal too — the rows a reviewer actually looks for', async () => {
    await harness.book.save(draft({ name: '***' }));

    expect(harness.store.auditFailures().map((held) => held.reason)).toEqual(['bad_name']);
  });
});

describe('PresetBook — forgetting', () => {
  it('removes a saved one and brings the built-in back', async () => {
    await harness.book.save(draft({ cwd: TREE }));

    expect(harness.book.forget({ projectPath: APP_NEXT, id: 'ticket' })).toBe(true);

    const ticket = harness.book.list().find((held) => held.id === 'ticket');
    expect(ticket?.builtIn).toBe(true);
    expect(ticket?.cwd).toBe(APP_NEXT);
  });

  it('answers false for a built-in, which has no row to remove', () => {
    expect(harness.book.forget({ projectPath: APP_NEXT, id: '365' })).toBe(false);
  });

  it('audits both outcomes', async () => {
    await harness.book.save(draft());
    harness.book.forget({ projectPath: APP_NEXT, id: 'ticket' });
    harness.book.forget({ projectPath: APP_NEXT, id: 'ticket' });

    const rows = harness.store.allAudit.filter((held) => held.action === 'preset.forget');
    expect(rows.map((held) => held.outcome)).toEqual(['ok', 'failed']);
  });
});

describe('PresetBook — an agent (P9-T1)', () => {
  const agentDraft = (over: Partial<PresetDraft> = {}): PresetDraft =>
    draft({
      name: 'review',
      profileFn: 'claude-365',
      promptSource: 'literal',
      prompt: 'review the diff',
      agent: 'code-reviewer',
      ...over,
    });

  it('saves an agent the project roster holds, and audits it beside the function', async () => {
    const saved = await harness.book.save(agentDraft());

    expect(saved.ok && saved.value.agent).toBe('code-reviewer');
    expect(harness.book.list().find((held) => held.id === 'review')?.agent).toBe('code-reviewer');
    const row = harness.store.allAudit.find((held) => held.action === 'preset.save');
    expect(row?.args).toEqual(['claude-365', '--agent', 'code-reviewer']);
  });

  it('refuses an agent the roster does not hold, and stores nothing', async () => {
    const saved = await harness.book.save(agentDraft({ agent: 'ghost' }));

    expect(saved).toEqual({ ok: false, error: 'unknown_agent' });
    expect(harness.store.savedPresets()).toEqual([]);
  });

  it('refuses any agent on the function that pins its own', async () => {
    // `claude-isg-orch` passes `--agent orchestrator`; a second one is two on one command line.
    const saved = await harness.book.save(agentDraft({ profileFn: 'claude-isg-orch' }));

    expect(saved).toEqual({ ok: false, error: 'pins_agent' });
    expect(harness.store.auditFailures().map((held) => held.reason)).toEqual(['pins_agent']);
  });

  it('checks the roster of the project the preset is filed under, not any project', async () => {
    await harness.registry.import(DOCS_TOOL);

    const saved = await harness.book.save(agentDraft({ projectPath: DOCS_TOOL }));

    expect(saved).toEqual({ ok: false, error: 'unknown_agent' });
  });

  it('keeps an agent-less save exactly as it was', async () => {
    const saved = await harness.book.save(agentDraft({ agent: undefined }));

    expect(saved.ok && saved.value.agent).toBeUndefined();
    const row = harness.store.allAudit.find((held) => held.action === 'preset.save');
    expect(row?.args).toEqual(['claude-365']);
  });
});

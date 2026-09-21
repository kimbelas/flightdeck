// The digest, and what it deliberately cannot see — P3-T7.
//
// Half of this file is about the EXCLUSIONS, because they are the design: a digest that noticed a
// `CLAUDE.md` being edited would report a config change most days, and one that noticed a worktree
// would report one per ticket. Those are the cases that turn the feature into a row nobody reads,
// so they are the cases with tests.
import { describe, expect, it } from 'vitest';
import {
  configDigest,
  CONFIG_FACETS,
  diffDigests,
  MAX_CHANGE_ENTRIES,
  parseConfigDigest,
  parseConfigDrift,
  parseConfigDrifts,
  sameDigest,
  type ConfigDigest,
} from '../../contracts/config-snapshot.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';

const PATH = String.raw`C:\Users\belas\Documents\development\app-next`;

function mapOf(over: Partial<WorkflowMap> = {}): WorkflowMap {
  return {
    path: PATH,
    at: 1_700_000_000_000,
    instructions: [
      { source: 'claude-md', bytes: 3482 },
      { source: 'agents-md', bytes: undefined },
    ],
    assets: [
      { kind: 'agent', name: 'german-ui-expert', description: 'x', model: undefined, tools: [] },
      {
        kind: 'command',
        name: 'design-check',
        description: undefined,
        model: undefined,
        tools: [],
      },
      { kind: 'skill', name: 'fix-review', description: undefined, model: undefined, tools: [] },
    ],
    hooks: [
      {
        event: 'PostToolUse',
        matcher: 'Edit|Write',
        condition: undefined,
        command: 'node fast-lint.mjs',
        async: true,
        timeoutSeconds: undefined,
      },
    ],
    servers: [{ name: 'chrome-devtools', transport: 'stdio' }],
    plugins: ['context-hygiene@claude-kit'],
    marketplaces: ['claude-kit'],
    permissions: {
      allow: ['Bash(git status:*)'],
      deny: ['Read(.env)'],
      ask: [],
      defaultMode: undefined,
    },
    conventions: [
      { folder: 'rules', files: 6 },
      { folder: 'specs', files: 0 },
    ],
    worktrees: [],
    gates: undefined,
    configured: true,
    ...over,
  };
}

describe('configDigest', () => {
  it('names every facet, so a diff can report a change in any of them', () => {
    expect(Object.keys(configDigest(mapOf())).sort()).toEqual([...CONFIG_FACETS].sort());
  });

  it('lists the assets by name, split by kind', () => {
    const digest = configDigest(mapOf());

    expect([digest.agents, digest.commands, digest.skills]).toEqual([
      ['german-ui-expert'],
      ['design-check'],
      ['fix-review'],
    ]);
  });

  it('identifies a hook by what runs — its event, its matcher and its command', () => {
    expect(configDigest(mapOf()).hooks).toEqual(['PostToolUse Edit|Write node fast-lint.mjs']);
  });

  // The most consequential single change this feature can report, and a digest of bare rule
  // strings would see it as no change at all.
  it('says which list a permission rule is on, so deny becoming ask is a change', () => {
    const before = configDigest(mapOf());
    const after = configDigest(
      mapOf({
        permissions: {
          allow: ['Bash(git status:*)'],
          deny: [],
          ask: ['Read(.env)'],
          defaultMode: undefined,
        },
      }),
    );

    expect(diffDigests(before, after)).toEqual([
      { facet: 'permissions', added: ['ask Read(.env)'], removed: ['deny Read(.env)'] },
    ]);
  });

  it('is stable under the order the readings came back in', () => {
    const one = configDigest(mapOf());
    const other = configDigest(
      mapOf({
        plugins: ['context-hygiene@claude-kit'],
        assets: [...mapOf().assets].reverse(),
      }),
    );

    expect(sameDigest(one, other)).toBe(true);
  });

  it('counts an instruction source only when the file is actually there', () => {
    // `agents-md` is in the stack with `bytes: undefined`, which is the source being ABSENT.
    expect(configDigest(mapOf()).instructions).toEqual(['claude-md']);
  });

  it('does not see a CLAUDE.md being edited — that is work, not configuration', () => {
    const before = configDigest(mapOf());
    const after = configDigest(mapOf({ instructions: [{ source: 'claude-md', bytes: 9999 }] }));

    expect(diffDigests(before, after)).toEqual([]);
  });

  it('does not see a worktree being created — that is git, not `.claude`', () => {
    const before = configDigest(mapOf());
    const after = configDigest(
      mapOf({
        worktrees: [
          { id: 'XWEB-1', path: String.raw`C:\trees\XWEB-1`, branch: 'XWEB-1', isMain: false },
        ],
      }),
    );

    expect(diffDigests(before, after)).toEqual([]);
  });

  it('does not see a convention folder gaining a file, only the folder appearing', () => {
    const grew = configDigest(mapOf({ conventions: [{ folder: 'rules', files: 40 }] }));
    const appeared = configDigest(
      mapOf({
        conventions: [
          { folder: 'rules', files: 6 },
          { folder: 'specs', files: 1 },
        ],
      }),
    );

    expect(diffDigests(configDigest(mapOf()), grew)).toEqual([]);
    expect(diffDigests(configDigest(mapOf()), appeared)).toEqual([
      { facet: 'conventions', added: ['specs'], removed: [] },
    ]);
  });

  it('does not see the instant the map was read', () => {
    expect(sameDigest(configDigest(mapOf()), configDigest(mapOf({ at: 9 })))).toBe(true);
  });

  it('does not see a hook timeout — a timeout that moves is not a new hook', () => {
    const after = configDigest(
      mapOf({
        hooks: [
          {
            event: 'PostToolUse',
            matcher: 'Edit|Write',
            condition: undefined,
            command: 'node fast-lint.mjs',
            async: false,
            timeoutSeconds: 30,
          },
        ],
      }),
    );

    expect(diffDigests(configDigest(mapOf()), after)).toEqual([]);
  });

  it('folds the gate counts in beside the gate definitions, from the same file', () => {
    const after = configDigest(
      mapOf({
        gates: { denyPaths: 5, askPaths: 1, gates: [{ kind: 'lint', label: 'blueprint' }] },
      }),
    );

    expect(after.gates).toEqual(['asks 1', 'denies 5', 'lint blueprint']);
  });
});

describe('diffDigests', () => {
  it('reports nothing when nothing moved', () => {
    expect(diffDigests(configDigest(mapOf()), configDigest(mapOf()))).toEqual([]);
  });

  it('reports a facet once, with what arrived and what left', () => {
    const after = configDigest(mapOf({ plugins: ['other@claude-kit'] }));

    expect(diffDigests(configDigest(mapOf()), after)).toEqual([
      {
        facet: 'plugins',
        added: ['other@claude-kit'],
        removed: ['context-hygiene@claude-kit'],
      },
    ]);
  });

  it('reports facets in the declared order, whatever order they changed in', () => {
    const after = configDigest(mapOf({ plugins: [], assets: [] }));

    expect(diffDigests(configDigest(mapOf()), after).map((change) => change.facet)).toEqual([
      'agents',
      'commands',
      'skills',
      'plugins',
    ]);
  });

  it('caps a facet — a renamed `.claude` is not a change list worth reading', () => {
    const many = Array.from(
      { length: MAX_CHANGE_ENTRIES + 6 },
      (unused, index) => `p-${String(index)}`,
    );
    const after = configDigest(mapOf({ plugins: many }));

    expect(diffDigests(configDigest(mapOf()), after)[0]?.added.length).toBe(MAX_CHANGE_ENTRIES);
  });
});

describe('parseConfigDigest', () => {
  it('round-trips through JSON, which is how the store holds it', () => {
    const digest = configDigest(mapOf());

    expect(parseConfigDigest(JSON.parse(JSON.stringify(digest)))).toEqual(digest);
  });

  it('answers undefined for something that is not a digest at all', () => {
    expect([parseConfigDigest('x'), parseConfigDigest([]), parseConfigDigest(null)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('drops a facet this build does not know rather than throwing on it', () => {
    const digest: ConfigDigest = configDigest(mapOf());
    const parsed = parseConfigDigest({ ...digest, telepathy: ['on'] });

    expect(parsed).toEqual(digest);
  });

  it('fills a facet the row does not carry, so an older row is readable', () => {
    expect(parseConfigDigest({ plugins: ['one'] })?.hooks).toEqual([]);
  });
});

describe('parseConfigDrift', () => {
  const WIRE = {
    path: PATH,
    at: 1_700_000_000_000,
    previousAt: 1_600_000_000_000,
    changes: [{ facet: 'hooks', added: ['PostToolUse * node lint.mjs'], removed: [] }],
  };

  it('reads one off the wire', () => {
    expect(parseConfigDrift(WIRE)).toEqual(WIRE);
  });

  // A drift with nothing in it is not a drift, and drawing an empty sentence would be worse than
  // drawing nothing.
  it('refuses one with no changes in it', () => {
    expect(parseConfigDrift({ ...WIRE, changes: [] })).toBeUndefined();
  });

  it('refuses one for no project, and one with no instant', () => {
    expect(parseConfigDrift({ ...WIRE, path: '' })).toBeUndefined();
    expect(parseConfigDrift({ ...WIRE, at: 'now' })).toBeUndefined();
  });

  it('drops a change naming a facet this build does not know', () => {
    const parsed = parseConfigDrift({
      ...WIRE,
      changes: [...WIRE.changes, { facet: 'telepathy', added: ['on'], removed: [] }],
    });

    expect(parsed?.changes.map((change) => change.facet)).toEqual(['hooks']);
  });

  it('reads a list, keeping the ones it can and dropping the ones it cannot', () => {
    expect(parseConfigDrifts([WIRE, { path: '' }, 7]).length).toBe(1);
    expect(parseConfigDrifts('no')).toEqual([]);
  });
});

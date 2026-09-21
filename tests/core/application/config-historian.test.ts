// The three cases, and the two that had to be decided rather than discovered — P3-T7.
//
// "A first sighting is not a change" and "the answer is the LAST change, not the change since you
// last looked" are both choices, both invisible in a type, and both the difference between a row
// that is useful and one that is noise. They get a test each and a comment each.
import { describe, expect, it } from 'vitest';
import { configDigest } from '../../../contracts/config-snapshot.ts';
import { projectKey } from '../../../contracts/project.ts';
import type { WorkflowMap } from '../../../contracts/workflow-map.ts';
import { ConfigHistorian } from '../../../core/application/config-historian.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const PATH = String.raw`C:\Users\belas\Documents\development\app-next`;
const KEY = projectKey(PATH);

function mapOf(over: Partial<WorkflowMap> = {}): WorkflowMap {
  return {
    path: PATH,
    at: 1_700_000_000_000,
    instructions: [{ source: 'claude-md', bytes: 3482 }],
    assets: [],
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
    servers: [],
    plugins: [],
    marketplaces: [],
    permissions: { allow: [], deny: [], ask: [], defaultMode: undefined },
    conventions: [],
    worktrees: [],
    gates: undefined,
    configured: true,
    ...over,
  };
}

/** A second hook, which is the change every case below uses. */
const CHANGED = mapOf({
  hooks: [
    ...mapOf().hooks,
    {
      event: 'PreCompact',
      matcher: undefined,
      condition: undefined,
      command: 'node state-dump.mjs',
      async: false,
      timeoutSeconds: 15,
    },
  ],
});

function build(at = 1_000): { historian: ConfigHistorian; store: FakeStore; clock: FakeClock } {
  const store = new FakeStore();
  const clock = new FakeClock(at);
  return {
    store,
    clock,
    historian: new ConfigHistorian({ store, clock, logger: new FakeLogger() }),
  };
}

describe('ConfigHistorian', () => {
  // Reporting seventeen hooks as "added" would mean every project announced a change on the day it
  // was imported, which is not what anybody means by a change.
  it('says nothing about a folder it has never seen, and records it', () => {
    const { historian, store } = build();

    expect(historian.observe(mapOf())).toBeUndefined();
    expect(store.configSnapshots(KEY, 2).length).toBe(1);
  });

  it('says nothing and writes nothing when the config has not moved', () => {
    const { historian, store } = build();
    historian.observe(mapOf());

    expect(historian.observe(mapOf())).toBeUndefined();
    expect(store.configSnapshots(KEY, 5).length).toBe(1);
  });

  it('reports what moved, and records the new configuration', () => {
    const { historian, store, clock } = build();
    historian.observe(mapOf());
    clock.advance(1_000);

    const drift = historian.observe(CHANGED);

    expect(drift).toEqual({
      path: PATH,
      at: 2_000,
      previousAt: 1_000,
      changes: [{ facet: 'hooks', added: ['PreCompact * node state-dump.mjs'], removed: [] }],
    });
    expect(store.configSnapshots(KEY, 5).length).toBe(2);
  });

  // A row that said "hooks changed" once and went blank on reload would erase itself. This is the
  // case that makes the second stored snapshot earn its place.
  it('keeps reporting the last change on every read after it, and writes nothing more', () => {
    const { historian, store, clock } = build();
    historian.observe(mapOf());
    clock.advance(1_000);
    historian.observe(CHANGED);
    clock.advance(7_000);

    const again = historian.observe(CHANGED);

    expect(again?.at).toBe(2_000);
    expect(again?.previousAt).toBe(1_000);
    expect(store.configSnapshots(KEY, 5).length).toBe(2);
  });

  it('reports the newest change rather than the first, after two of them', () => {
    const { historian, clock } = build();
    historian.observe(mapOf());
    clock.advance(1_000);
    historian.observe(CHANGED);
    clock.advance(1_000);

    const drift = historian.observe(mapOf());

    expect(drift?.at).toBe(3_000);
    expect(drift?.previousAt).toBe(2_000);
    expect(drift?.changes).toEqual([
      { facet: 'hooks', added: [], removed: ['PreCompact * node state-dump.mjs'] },
    ]);
  });

  it('reports a removal as a removal, not as a folder with no config', () => {
    const { historian, clock } = build();
    historian.observe(mapOf());
    clock.advance(1_000);

    expect(historian.observe(mapOf({ hooks: [] }))?.changes).toEqual([
      { facet: 'hooks', added: [], removed: ['PostToolUse Edit|Write node fast-lint.mjs'] },
    ]);
  });

  it('keeps folders apart — a change in one is not a change in the other', () => {
    const { historian } = build();
    const other = String.raw`C:\Users\belas\Documents\development\docs-tool`;
    historian.observe(mapOf());

    expect(historian.observe(mapOf({ path: other }))).toBeUndefined();
    expect(historian.observe(mapOf({ path: other }))).toBeUndefined();
  });

  it('answers only the folders that have drifted, in the order it was given them', () => {
    const { historian, clock } = build();
    const other = String.raw`C:\Users\belas\Documents\development\docs-tool`;
    historian.observeAll([mapOf(), mapOf({ path: other })]);
    clock.advance(1_000);

    const drifts = historian.observeAll([CHANGED, mapOf({ path: other })]);

    expect(drifts.map((drift) => drift.path)).toEqual([PATH]);
  });

  // The configuration is still on screen; only the "what changed" line is missing. Failing the
  // map request over a history nobody can read would be the tail wagging the dog.
  it('reports no drift rather than throwing when the history cannot be read', () => {
    // A store whose READS throw, which `FakeStore` has no mode for and which `ConfigStore` exists
    // to make expressible: a narrow port is what lets a failure be described in four lines.
    const historian = new ConfigHistorian({
      store: {
        rememberConfigSnapshot: () => {
          throw new Error('disk full');
        },
        configSnapshots: () => {
          throw new Error('database is locked');
        },
      },
      clock: new FakeClock(1_000),
      logger: new FakeLogger(),
    });

    expect(historian.observe(mapOf())).toBeUndefined();
  });

  it('still reports the change when the store refuses the WRITE, using the clock for the instant', () => {
    const { historian, store, clock } = build();
    historian.observe(mapOf());
    store.breakWrites();
    clock.advance(1_000);

    expect(historian.observe(CHANGED)?.at).toBe(2_000);
  });

  it('compares against what the store gave back, not against what it was handed', () => {
    // The round trip is through `parseConfigDigest` in the adapter; an implementation that
    // returned a digest in a different order would make every read report a change.
    const { historian, store } = build();
    historian.observe(mapOf());
    const held = store.configSnapshots(KEY, 1)[0];

    expect(held?.digest).toEqual(configDigest(mapOf()));
  });
});

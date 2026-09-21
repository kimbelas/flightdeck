// The config-history half of the `Store` contract, run against every implementation — P3-T7.
//
// A third file for `preset-store-contract.ts`'s reason — the other two are at their line limit —
// and for one of its own: this table is neither of the kinds the other two describe. It is not a
// keyed row that can be replaced or taken away, and it is not paged by `since=`. It is append-only
// and BOUNDED, and the bound is the part an implementation can get wrong silently.
import { describe, expect, it } from 'vitest';
import {
  configDigest,
  MAX_CONFIG_SNAPSHOTS,
  type ConfigDigest,
} from '../../../contracts/config-snapshot.ts';
import { projectKey } from '../../../contracts/project.ts';
import type { WorkflowMap } from '../../../contracts/workflow-map.ts';
import type { Store } from '../../../core/ports/store.ts';

const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;
const DOCS_TOOL = String.raw`C:\Users\belas\Documents\development\docs-tool`;

/** A digest built the way core builds one, so the round trip is over a real value. */
function digestOf(over: Partial<WorkflowMap> = {}): ConfigDigest {
  return configDigest({
    path: APP_NEXT,
    at: 1_700_000_000_000,
    instructions: [{ source: 'claude-md', bytes: 3482 }],
    assets: [
      {
        kind: 'agent',
        name: 'german-ui-expert',
        description: undefined,
        model: undefined,
        tools: [],
      },
    ],
    hooks: [],
    servers: [],
    plugins: ['context-hygiene@claude-kit'],
    marketplaces: [],
    permissions: {
      allow: ['Bash(git status:*)'],
      deny: ['Read(.env)'],
      ask: [],
      defaultMode: undefined,
    },
    conventions: [],
    worktrees: [],
    gates: undefined,
    configured: true,
    ...over,
  });
}

/** Runs the config-history contract against `make`. Called once per implementation. */
export function describeConfigStoreContract(name: string, make: () => Store): void {
  describe(`${name} — config snapshots (P3-T7)`, () => {
    const KEY = projectKey(APP_NEXT);

    it('starts empty — a folder nobody has read has no history', () => {
      expect(make().configSnapshots(KEY, 2)).toEqual([]);
    });

    it('round-trips a digest through the store rather than echoing it', () => {
      const store = make();
      const digest = digestOf();

      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 17, digest });

      expect(store.configSnapshots(KEY, 2)).toEqual([
        { id: expect.any(Number) as number, projectKey: KEY, takenAt: 17, digest },
      ]);
    });

    it('answers newest first, which is what a diff of the top two means', () => {
      const store = make();
      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 1, digest: digestOf() });
      store.rememberConfigSnapshot({
        projectKey: KEY,
        takenAt: 2,
        digest: digestOf({ plugins: [] }),
      });

      expect(store.configSnapshots(KEY, 2).map((one) => one.takenAt)).toEqual([2, 1]);
    });

    // Written in the same millisecond is not hypothetical: the historian stamps from one clock,
    // and a fake clock does not move. The order that matters is the order they were WRITTEN.
    it('orders two written at the same instant by when they were written', () => {
      const store = make();
      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 5, digest: digestOf() });
      const second = store.rememberConfigSnapshot({
        projectKey: KEY,
        takenAt: 5,
        digest: digestOf({ plugins: [] }),
      });

      expect(store.configSnapshots(KEY, 1)).toEqual([second]);
    });

    it('keeps each project apart — a change in one is not a change in the other', () => {
      const store = make();
      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 1, digest: digestOf() });

      expect(store.configSnapshots(projectKey(DOCS_TOOL), 2)).toEqual([]);
    });

    // The bound is the reason this table cannot grow with how long Flightdeck has been installed.
    it(`keeps the newest ${String(MAX_CONFIG_SNAPSHOTS)} and drops the rest`, () => {
      const store = make();
      for (let taken = 1; taken <= MAX_CONFIG_SNAPSHOTS + 5; taken += 1) {
        store.rememberConfigSnapshot({
          projectKey: KEY,
          takenAt: taken,
          digest: digestOf({ plugins: [`plugin-${String(taken)}`] }),
        });
      }

      const held = store.configSnapshots(KEY, MAX_CONFIG_SNAPSHOTS + 10);

      expect(held.length).toBe(MAX_CONFIG_SNAPSHOTS);
      expect(held[0]?.takenAt).toBe(MAX_CONFIG_SNAPSHOTS + 5);
      expect(held.at(-1)?.takenAt).toBe(6);
    });

    it('prunes per project, so a busy folder does not evict a quiet one', () => {
      const store = make();
      const other = projectKey(DOCS_TOOL);
      store.rememberConfigSnapshot({ projectKey: other, takenAt: 1, digest: digestOf() });
      for (let taken = 1; taken <= MAX_CONFIG_SNAPSHOTS + 5; taken += 1) {
        store.rememberConfigSnapshot({
          projectKey: KEY,
          takenAt: taken,
          digest: digestOf({ plugins: [`plugin-${String(taken)}`] }),
        });
      }

      expect(store.configSnapshots(other, 5).length).toBe(1);
    });

    // A snapshot is an observation: it says what was true at an instant, and the folder being
    // withdrawn afterwards does not make that untrue. Re-importing should not have lost it.
    it('survives the folder being forgotten — it is what happened, not a permission', () => {
      const store = make();
      store.rememberProject({ path: APP_NEXT, name: 'app-next', importedAt: 1 });
      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 1, digest: digestOf() });

      store.forgetProject(APP_NEXT);

      expect(store.configSnapshots(KEY, 2).length).toBe(1);
    });

    it('asks for none and gets none rather than the whole table', () => {
      const store = make();
      store.rememberConfigSnapshot({ projectKey: KEY, takenAt: 1, digest: digestOf() });

      expect(store.configSnapshots(KEY, 0)).toEqual([]);
    });
  });
}

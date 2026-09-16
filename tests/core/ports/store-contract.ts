// The `Store` contract, run against every implementation of it — P1-T8.
//
// The fake's own header says "nothing above the port can tell them apart, which is the test that
// the port is the right shape". This is that test, made literal: one suite, two subjects. A fake
// that drifts from the adapter is worse than no fake at all, because every test above the port is
// then passing against behaviour that does not ship.
//
// It takes a factory rather than an instance so each `it` gets a clean store — a sqlite file is
// shared state in a way an array is not, and a suite whose cases depend on each other's rows would
// pass in one order and fail in another.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import type { DraftAuditRow } from '../../../contracts/audit-row.ts';
import type { ProjectRecord } from '../../../contracts/project.ts';
import type { DraftVitalsSnapshot } from '../../../contracts/vitals-snapshot.ts';
import type { Store } from '../../../core/ports/store.ts';

const SESSION = '11111111-2222-4333-a444-555555555555';
const OTHER = '99999999-8888-4777-a666-555555555555';

function event(over: Partial<DraftEvent> = {}): DraftEvent {
  return {
    at: 1_700_000_000_000,
    sessionId: SESSION,
    subscription: '365',
    source: 'hook',
    type: 'Stop',
    payload: { hook_event_name: 'Stop' },
    ...over,
  };
}

function audit(over: Partial<DraftAuditRow> = {}): DraftAuditRow {
  return {
    at: 1_700_000_000_000,
    who: 'token',
    action: 'launch',
    target: SESSION,
    args: ['--bg', '-n', 'a name'],
    outcome: 'ok',
    reason: undefined,
    ...over,
  };
}

function snapshot(over: Partial<DraftVitalsSnapshot> = {}): DraftVitalsSnapshot {
  return {
    at: 1_700_000_000_000,
    sessionId: SESSION,
    subscription: '365',
    usedPercentage: 20,
    contextWindowSize: 200_000,
    costUsd: 1.5,
    modelId: 'claude-opus-5',
    ...over,
  };
}

/** Runs the whole contract against `make`. Called once per implementation. */
export function describeStoreContract(name: string, make: () => Store): void {
  describe(`${name} — events`, () => {
    it('hands out monotonic ids starting at 1', () => {
      const store = make();

      expect(store.appendEvent(event()).id).toBe(1);
      expect(store.appendEvent(event()).id).toBe(2);
      expect(store.appendEvent(event()).id).toBe(3);
    });

    it('returns the event it was given, with an id', () => {
      const store = make();

      const stored = store.appendEvent(event({ type: 'SessionStart' }));

      expect(stored.type).toBe('SessionStart');
      expect(stored.sessionId).toBe(SESSION);
      expect(stored.subscription).toBe('365');
      expect(stored.source).toBe('hook');
    });

    it('pages with since=, oldest first, and cannot skip one', () => {
      const store = make();
      for (let index = 0; index < 5; index += 1) store.appendEvent(event({ at: index }));

      const first = store.eventsSince(0, 2);
      const second = store.eventsSince(first[1]?.id ?? 0, 2);

      expect(first.map((row) => row.id)).toEqual([1, 2]);
      expect(second.map((row) => row.id)).toEqual([3, 4]);
    });

    it('narrows to one session without renumbering', () => {
      const store = make();
      store.appendEvent(event());
      store.appendEvent(event({ sessionId: OTHER }));
      store.appendEvent(event());

      const mine = store.eventsForSession(SESSION, 0, 10);

      // The ids are the store's, not the page's — a consumer pages the same sequence either way.
      expect(mine.map((row) => row.id)).toEqual([1, 3]);
    });

    it('round-trips a payload through whatever it is stored as', () => {
      const store = make();
      const payload = { nested: { list: [1, 2, 3], text: 'a value', flag: true }, empty: null };

      store.appendEvent(event({ payload }));

      expect(store.eventsSince(0, 1)[0]?.payload).toEqual(payload);
    });

    it('keeps an absent payload absent rather than inventing one', () => {
      const store = make();

      store.appendEvent(event({ payload: undefined }));

      expect(store.eventsSince(0, 1)[0]?.payload).toBeUndefined();
    });

    it('returns nothing for a limit of zero or less, rather than everything', () => {
      const store = make();
      store.appendEvent(event());

      expect(store.eventsSince(0, 0)).toEqual([]);
      expect(store.eventsSince(0, -1)).toEqual([]);
    });

    it('returns nothing when since is past the end', () => {
      const store = make();
      store.appendEvent(event());

      expect(store.eventsSince(99, 10)).toEqual([]);
    });
  });

  describe(`${name} — audit`, () => {
    it('numbers audit rows in their own sequence, not the events one', () => {
      const store = make();
      store.appendEvent(event());
      store.appendEvent(event());

      // A shared counter would make `since=` on one table skip rows of the other.
      expect(store.appendAudit(audit()).id).toBe(1);
    });

    it('round-trips args as an array and keeps the outcome', () => {
      const store = make();

      store.appendAudit(audit({ args: ['a', 'b'], outcome: 'failed', reason: 'exit 1' }));
      const [row] = store.auditSince(0, 10);

      expect(row?.args).toEqual(['a', 'b']);
      expect(row?.outcome).toBe('failed');
      expect(row?.reason).toBe('exit 1');
    });

    it('keeps an absent reason absent', () => {
      const store = make();

      store.appendAudit(audit());

      expect(store.auditSince(0, 10)[0]?.reason).toBeUndefined();
    });
  });

  describe(`${name} — vitals snapshots`, () => {
    it('numbers snapshots in their own sequence', () => {
      const store = make();
      store.appendEvent(event());
      store.appendAudit(audit());

      expect(store.appendSnapshot(snapshot()).id).toBe(1);
    });

    it('round-trips every value a chart plots', () => {
      const store = make();

      store.appendSnapshot(snapshot());
      const [row] = store.snapshotsForSession(SESSION, 10);

      expect(row?.usedPercentage).toBe(20);
      expect(row?.contextWindowSize).toBe(200_000);
      expect(row?.costUsd).toBe(1.5);
      expect(row?.modelId).toBe('claude-opus-5');
    });

    it('keeps undefined distinguishable from zero', () => {
      const store = make();

      store.appendSnapshot(snapshot({ usedPercentage: undefined, costUsd: 0 }));
      const [row] = store.snapshotsForSession(SESSION, 10);

      // A session that has not spoken reports no percentage; one that has spent nothing reports 0.
      // Collapsing them paints a 0 % context bar on every fresh session (F.3.5).
      expect(row?.usedPercentage).toBeUndefined();
      expect(row?.costUsd).toBe(0);
    });

    it('hands back the most recent N, oldest first', () => {
      const store = make();
      for (let index = 1; index <= 5; index += 1) {
        store.appendSnapshot(snapshot({ at: index, usedPercentage: index }));
      }

      const recent = store.snapshotsForSession(SESSION, 3);

      // The newest three, in time order — what a sparkline draws left to right.
      expect(recent.map((row) => row.usedPercentage)).toEqual([3, 4, 5]);
    });

    it('does not mix sessions', () => {
      const store = make();
      store.appendSnapshot(snapshot());
      store.appendSnapshot(snapshot({ sessionId: OTHER }));

      expect(store.snapshotsForSession(SESSION, 10)).toHaveLength(1);
      expect(store.snapshotsForSession('nobody', 10)).toEqual([]);
    });
  });
  describe(`${name} — the project registry (P3-T1)`, () => {
    const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;
    const DOCS_TOOL = String.raw`C:\Users\belas\Documents\development\docs-tool`;

    function project(over: Partial<ProjectRecord> = {}): ProjectRecord {
      return { path: APP_NEXT, name: 'app-next', importedAt: 1_700_000_000_000, ...over };
    }

    it('starts empty, on both implementations (D26)', () => {
      expect(make().projects()).toEqual([]);
    });

    it('round-trips a record', () => {
      const store = make();

      store.rememberProject(project());

      expect(store.projects()).toEqual([project()]);
    });

    it('keys by the folder, so re-importing replaces rather than duplicates', () => {
      const store = make();

      store.rememberProject(project());
      store.rememberProject(project({ path: APP_NEXT.toLowerCase(), importedAt: 9 }));

      expect(store.projects()).toHaveLength(1);
    });

    it('keeps the FIRST importedAt through a re-import', () => {
      const store = make();

      store.rememberProject(project());
      const again = store.rememberProject(project({ importedAt: 9 }));

      // "When did I add this" is a fact about the decision, and the second click is not one.
      expect(again.importedAt).toBe(1_700_000_000_000);
      expect(store.projects()[0]?.importedAt).toBe(1_700_000_000_000);
    });

    it('re-displays the path in the casing the filesystem now uses', () => {
      const store = make();

      store.rememberProject(project());
      store.rememberProject(project({ path: APP_NEXT.toUpperCase(), name: 'APP-NEXT' }));

      expect(store.projects()[0]?.path).toBe(APP_NEXT.toUpperCase());
    });

    it('hands back the newest first', () => {
      const store = make();

      store.rememberProject(project({ importedAt: 1 }));
      store.rememberProject(project({ path: DOCS_TOOL, name: 'docs-tool', importedAt: 2 }));

      expect(store.projects().map((held) => held.name)).toEqual(['docs-tool', 'app-next']);
    });

    it('removes one by any spelling of its path, and says whether it did', () => {
      const store = make();
      store.rememberProject(project());

      expect(store.forgetProject(APP_NEXT.replaceAll('\\', '/').toUpperCase())).toBe(true);
      expect(store.projects()).toEqual([]);
      expect(store.forgetProject(APP_NEXT)).toBe(false);
    });

    it('does not mix the registry into the logs beside it', () => {
      const store = make();

      store.rememberProject(project());

      expect(store.eventsSince(0, 10)).toEqual([]);
      expect(store.auditSince(0, 10)).toEqual([]);
    });
  });
}

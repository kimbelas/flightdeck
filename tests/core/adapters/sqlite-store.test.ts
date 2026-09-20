// The real store, on a real file — P1-T8.
//
// The shared contract below runs the same suite against `FakeStore`, which is what proves the two
// cannot drift. Everything after it is the part only the adapter has: migrations, the payload cap,
// and what happens when the same file is opened twice.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_CHARS,
  SqliteStore,
  type TruncatedPayload,
} from '../../../core/adapters/sqlite/sqlite-store.ts';
import { MIGRATIONS } from '../../../core/adapters/sqlite/schema.ts';
import { FakeStore } from '../../fakes/fake-store.ts';
import { describePresetStoreContract } from '../ports/preset-store-contract.ts';
import { describeStoreContract } from '../ports/store-contract.ts';

let directory = '';
/**
 * Every store this file opens, so `afterEach` can close them.
 *
 * Windows will not delete a directory that something still holds a handle on, and WAL leaves a
 * `-wal` and a `-shm` beside the database — so a suite that merely stopped using a store failed
 * its own cleanup with `EPERM`, sixteen tests at a time. `close()` is idempotent, so a test that
 * closes its own store is no problem here.
 */
const opened: SqliteStore[] = [];

function open(name = 'flightdeck.db'): SqliteStore {
  const store = new SqliteStore(join(directory, name));
  opened.push(store);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fd-store-'));
});

afterEach(() => {
  for (const store of opened) store.close();
  opened.length = 0;
  rmSync(directory, { recursive: true, force: true });
});

// The whole point: one suite, both implementations. A divergence fails here rather than in P2.
describeStoreContract('FakeStore', () => new FakeStore());
describeStoreContract('SqliteStore', () => open(`${String(Math.random()).slice(2)}.db`));
// The preset half, in its own file for `store-contract.ts`'s line limit — P4-T1.
describePresetStoreContract('FakeStore', () => new FakeStore());
describePresetStoreContract('SqliteStore', () => open(`${String(Math.random()).slice(2)}.db`));

describe('SqliteStore — the file', () => {
  it('creates the database and its directory', () => {
    const store = open(join('nested', 'deeper', 'flightdeck.db'));

    // Core may be the first thing to run after an install, so %LOCALAPPDATA%\flightdeck may not
    // exist yet — and refusing to start over a missing directory would be a poor first impression.
    expect(store.version).toBe(MIGRATIONS.length);
    store.close();
  });

  it('migrates to the current version and stays there on reopen', () => {
    const first = open();
    first.appendEvent({
      at: 1,
      sessionId: 's',
      subscription: '365',
      source: 'hook',
      type: 'Stop',
      payload: {},
    });
    first.close();

    const second = open();

    expect(second.version).toBe(MIGRATIONS.length);
    expect(second.eventsSince(0, 10)).toHaveLength(1);
    second.close();
  });

  it('keeps ids going across a reopen, because since= pages one sequence forever', () => {
    const first = open();
    const draft = {
      at: 1,
      sessionId: 's',
      subscription: '365',
      source: 'hook',
      type: 'Stop',
      payload: {},
    } as const;
    first.appendEvent(draft);
    first.close();

    const second = open();
    const next = second.appendEvent(draft);

    // A consumer that stopped at 1 and comes back after a core restart must not be handed a second
    // row numbered 1 — it would skip it forever.
    expect(next.id).toBe(2);
    second.close();
  });

  it('closes twice without complaining, because shutdown is idempotent', () => {
    const store = open();

    store.close();

    expect(() => {
      store.close();
    }).not.toThrow();
  });

  it('refuses to open a file that is not a database, rather than starting without one', () => {
    const path = join(directory, 'not-a-db.db');
    writeFileSync(path, 'this is not sqlite', 'utf8');

    // An event log nobody can write to is worse silent than loud — core must not start on it.
    expect(() => new SqliteStore(path)).toThrow();
  });
});

describe('SqliteStore — the payload cap', () => {
  const draft = {
    at: 1,
    sessionId: 's',
    subscription: '365',
    source: 'hook',
    type: 'PostToolUse',
  } as const;

  it('keeps a large payload that is under the cap verbatim', () => {
    const store = open();
    const payload = { text: 'x'.repeat(1000) };

    store.appendEvent({ ...draft, payload });

    expect(store.eventsSince(0, 1)[0]?.payload).toEqual(payload);
    store.close();
  });

  it('replaces one over the cap with a marker saying how big it was', () => {
    const store = open();
    const payload = { text: 'x'.repeat(MAX_PAYLOAD_CHARS + 1) };

    store.appendEvent({ ...draft, payload });
    const stored = store.eventsSince(0, 1)[0]?.payload as TruncatedPayload | undefined;

    // Honest rather than silent: a 4 MB body per turn per session is unbounded growth in the one
    // file that is never deleted, and half a payload pretending to be whole is worse than a marker.
    expect(stored?.truncated).toBe(true);
    expect(stored?.chars).toBeGreaterThan(MAX_PAYLOAD_CHARS);
    store.close();
  });

  it('stores nothing rather than throwing on a payload that cannot be JSON', () => {
    const store = open();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    // `payload` is `unknown` by contract, and this is on the hook path — a throw here would be a
    // 500 on a hook, which Claude Code shows the owner on every turn afterwards (F.1.5).
    expect(() => {
      store.appendEvent({ ...draft, payload: circular });
    }).not.toThrow();
    expect(store.eventsSince(0, 1)[0]?.payload).toBeUndefined();
    store.close();
  });
});

describe('SqliteStore — reading a file this build did not write', () => {
  it('reads a row with an unknown source as something valid rather than throwing', () => {
    const path = join(directory, 'foreign.db');
    const store = open('foreign.db');
    store.close();

    const raw = new DatabaseSync(path);
    raw
      .prepare(
        `INSERT INTO events (at, session_id, subscription, source, type, payload)
         VALUES (1, 's', 'mars', 'telepathy', 'Stop', 'not json')`,
      )
      .run();
    raw.close();

    const reopened = open('foreign.db');
    const [row] = reopened.eventsSince(0, 10);

    // The file may have been written by an older or a newer build, so a row is a boundary like any
    // other (§11.1). One unreadable row must not take out the page around it.
    expect(row?.source).toBe('reconcile');
    expect(row?.subscription).toBe('365');
    expect(row?.payload).toBeUndefined();
    reopened.close();
  });
});

// SPEC §5.8's five filters, on a real file — P7-T2.
//
// `sqlite-search.test.ts` is the tokenizer and the ranking; this is the WHERE clause. Every filter
// is `(:x IS NULL OR …)` in one prepared statement, which is exactly the kind of SQL that is right
// for thirty-one combinations and silently wrong for the thirty-second, so each is tested alone,
// the project's worktree rule is tested against the near-miss it exists to refuse, and migration
// 9 is tested from a version-8 file, because it is the one that touches data the owner already has.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../../core/adapters/sqlite/schema.ts';
import { SqliteStore } from '../../../core/adapters/sqlite/sqlite-store.ts';
import { NO_FILTERS, type SearchFilters } from '../../../contracts/search-filters.ts';
import { toMatchExpression } from '../../../contracts/transcript-search.ts';
import type { TranscriptIndexBatch } from '../../../core/ports/store.ts';

let directory = '';
const opened: SqliteStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'flightdeck-filters-'));
});

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

function file(): string {
  return join(directory, 'flightdeck.db');
}

function open(): SqliteStore {
  const store = new SqliteStore(file());
  opened.push(store);
  return store;
}

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const DAY = 86_400_000;

function batch(sessionId: string, over: Partial<TranscriptIndexBatch> = {}): TranscriptIndexBatch {
  return {
    path: `C:\\t\\${sessionId}.jsonl`,
    subscription: '365',
    sessionId,
    projectKey: 'C--work-app',
    cursor: { offset: 100, identity: 'dev:1:2026' },
    at: 0,
    restarted: false,
    excerpts: [{ kind: 'you', text: 'deploy the worker to cloudflare', at: 10 * DAY }],
    tools: [],
    ...over,
  };
}

function found(store: SqliteStore, filters: Partial<SearchFilters>): readonly string[] {
  return store
    .searchTranscripts({
      match: toMatchExpression('cloudflare deploy') ?? '""',
      limit: 20,
      filters: { ...NO_FILTERS, ...filters },
    })
    .map((hit) => hit.sessionId);
}

describe('the search filters — each alone', () => {
  it('finds both sessions with no filter, as P7-T1 did', () => {
    const store = open();
    store.indexTranscript(batch(A));
    store.indexTranscript(batch(B));

    expect([...found(store, {})].sort()).toEqual([A, B]);
  });

  it('narrows to one subscription', () => {
    const store = open();
    store.indexTranscript(batch(A));
    store.indexTranscript(batch(B, { subscription: 'isg' }));

    expect(found(store, { subscription: 'isg' })).toEqual([B]);
  });

  // The worktree rule, and the near miss it refuses: `C--work-app` must not match `C--work-apple`,
  // which a bare prefix would.
  it('narrows to a project, its worktrees included and its namesakes not', () => {
    const store = open();
    store.indexTranscript(batch(A));
    store.indexTranscript(batch(B, { projectKey: 'C--work-app--claude-worktrees-xweb-1' }));
    store.indexTranscript(
      batch('cccccccc-0000-4000-8000-000000000003', { projectKey: 'C--work-apple' }),
    );

    expect([...found(store, { project: 'C--work-app' })].sort()).toEqual([A, B]);
  });

  it('matches the project without regard to case, as a Windows path is', () => {
    const store = open();
    store.indexTranscript(batch(A, { projectKey: 'c--Work-App' }));

    expect(found(store, { project: 'C--work-app' })).toEqual([A]);
  });

  it('narrows by date, on when the matching LINE was written', () => {
    const store = open();
    store.indexTranscript(batch(A));
    store.indexTranscript(
      batch(B, { excerpts: [{ kind: 'you', text: 'cloudflare deploy', at: 40 * DAY }] }),
    );

    expect(found(store, { since: 30 * DAY })).toEqual([B]);
    expect(found(store, { until: 30 * DAY })).toEqual([A]);
    expect(found(store, { since: 5 * DAY, until: 20 * DAY })).toEqual([A]);
  });

  // A line with no timestamp is stored at 0. It is undated, not "older than thirty days".
  it('keeps an undated line out of an until range', () => {
    const store = open();
    store.indexTranscript(
      batch(A, { excerpts: [{ kind: 'title', text: 'cloudflare deploy', at: undefined }] }),
    );

    expect(found(store, { until: 30 * DAY })).toEqual([]);
    expect(found(store, {})).toEqual([A]);
  });

  it('narrows to one session, by its full id or its short one', () => {
    const store = open();
    store.indexTranscript(batch(A));
    store.indexTranscript(batch(B));

    expect(found(store, { session: A })).toEqual([A]);
    expect(found(store, { session: 'bbbbbbbb' })).toEqual([B]);
  });

  it('narrows to sessions that called a tool, anywhere in them', () => {
    const store = open();
    store.indexTranscript(batch(A, { tools: ['Bash', 'WebFetch'] }));
    store.indexTranscript(batch(B, { tools: ['Read'] }));

    expect(found(store, { tool: 'WebFetch' })).toEqual([A]);
    expect(found(store, { tool: 'Edit' })).toEqual([]);
  });

  // Tools are a session's, not a slice's: a later slice that calls nothing new keeps what an
  // earlier one recorded, and the same tool twice is one row.
  it('keeps a session’s tools across slices', () => {
    const store = open();
    store.indexTranscript(batch(A, { tools: ['Bash'] }));
    store.indexTranscript(batch(A, { tools: ['Bash'], excerpts: [] }));

    expect(found(store, { tool: 'Bash' })).toEqual([A]);
    expect(store.transcriptTools(10)).toEqual(['Bash']);
  });

  it('forgets a session’s tools with its excerpts when the transcript restarts', () => {
    const store = open();
    store.indexTranscript(batch(A, { tools: ['Bash'] }));
    store.indexTranscript(batch(A, { restarted: true, tools: ['Read'] }));

    expect(found(store, { tool: 'Bash' })).toEqual([]);
    expect(found(store, { tool: 'Read' })).toEqual([A]);
  });

  it('combines filters as AND', () => {
    const store = open();
    store.indexTranscript(batch(A, { tools: ['Bash'] }));
    store.indexTranscript(batch(B, { subscription: 'isg', tools: ['Bash'] }));

    expect(found(store, { tool: 'Bash', subscription: '365' })).toEqual([A]);
  });
});

describe('the tool picker', () => {
  it('lists the tools by how many sessions called them, then by name', () => {
    const store = open();
    store.indexTranscript(batch(A, { tools: ['Bash', 'Read', 'Edit'] }));
    store.indexTranscript(batch(B, { tools: ['Read', 'Bash'] }));

    expect(store.transcriptTools(10)).toEqual(['Bash', 'Read', 'Edit']);
    expect(store.transcriptTools(1)).toEqual(['Bash']);
  });

  it('is empty before anything is indexed', () => {
    expect(open().transcriptTools(10)).toEqual([]);
  });
});

describe('migration 9', () => {
  /**
   * The one migration that touches what the owner already has.
   *
   * The cursors go, so every transcript is read again with its tool calls; the excerpts stay,
   * because a transcript `cleanupPeriodDays` has deleted is never read again and its excerpts are
   * the only copy left (SPEC §5.8).
   */
  it('drops every cursor and keeps every excerpt', () => {
    const db = new DatabaseSync(file());
    for (const step of MIGRATIONS.slice(0, 8)) db.exec(step);
    db.exec('PRAGMA user_version = 8');
    db.prepare(
      `INSERT INTO transcript_excerpts (subscription, session_id, project_key, kind, at, text)
       VALUES ('365', ?, 'C--work-app', 'you', ?, 'deploy to cloudflare')`,
    ).run(A, 10 * DAY);
    db.prepare(
      `INSERT INTO transcript_cursors
         (path, subscription, session_id, project_key, offset_bytes, identity, indexed_at)
       VALUES ('C:\\t\\a.jsonl', '365', ?, 'C--work-app', 900, 'dev:1:2026', 1)`,
    ).run(A);
    db.close();

    const store = open();

    expect(store.version).toBe(MIGRATIONS.length);
    expect(store.transcriptCursor('C:\\t\\a.jsonl')).toBeUndefined();
    expect(found(store, {})).toEqual([A]);
  });
});

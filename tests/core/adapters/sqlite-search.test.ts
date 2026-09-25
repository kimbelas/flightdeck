// The FTS5 index, on a real file — P7-T1, SPEC §5.8.
//
// **The half `FakeStore` cannot cover, and the reason it exists.** The fake matches substrings;
// this is the tokenizer, the ranking, the snippet window and the triggers that keep an
// external-content index in step with its table. Every one of those belongs to SQLite, and every
// one of them is a way for the index to be silently wrong: a search that finds nothing looks
// exactly like a machine nobody has worked on.
//
// D9 is why this can be taken for granted at all — `node:sqlite` on an older Node had no FTS5, and
// `npm run doctor` re-checks it after an upgrade for that reason.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../../../core/adapters/sqlite/sqlite-store.ts';
import { NO_FILTERS } from '../../../contracts/search-filters.ts';
import { toMatchExpression } from '../../../contracts/transcript-search.ts';
import type { TranscriptProse } from '../../../contracts/transcript-prose.ts';
import type { TranscriptIndexBatch } from '../../../core/ports/store.ts';

let directory = '';
const opened: SqliteStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'flightdeck-search-'));
});

afterEach(() => {
  // Windows will not delete a directory something holds a handle on, and WAL leaves two files
  // beside the database — `sqlite-store.test.ts` paid for this lesson sixteen tests at a time.
  for (const store of opened.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

function open(): SqliteStore {
  const store = new SqliteStore(join(directory, 'flightdeck.db'));
  opened.push(store);
  return store;
}

const SESSION = 'aaaaaaaa-0000-0000-0000-000000000000';
const OTHER = 'bbbbbbbb-0000-0000-0000-000000000000';

function prose(text: string, over: Partial<TranscriptProse> = {}): TranscriptProse {
  return { kind: 'you', text, at: 1000, ...over };
}

function batch(over: Partial<TranscriptIndexBatch> = {}): TranscriptIndexBatch {
  return {
    path: `C:\\home\\.claude-365\\projects\\C--work\\${SESSION}.jsonl`,
    subscription: '365',
    sessionId: SESSION,
    projectKey: 'C--work',
    cursor: { offset: 100, identity: 'dev:1:2026' },
    at: 2000,
    restarted: false,
    excerpts: [],
    tools: [],
    ...over,
  };
}

/** What the deck would send for a typed query. Never a raw string — FTS5 has a grammar. */
function search(
  store: SqliteStore,
  query: string,
  limit = 20,
): ReturnType<SqliteStore['searchTranscripts']> {
  return store.searchTranscripts({
    match: toMatchExpression(query) ?? '""',
    limit,
    filters: NO_FILTERS,
  });
}

describe('the FTS5 index — finding things', () => {
  it('finds a session by something the owner typed in it', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('deploy this to cloudflare workers')] }));

    const hits = search(store, 'cloudflare');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ subscription: '365', sessionId: SESSION, kind: 'you' });
  });

  it('finds it by something Claude said', () => {
    const store = open();
    store.indexTranscript(
      batch({ excerpts: [prose('Deployed the worker to Cloudflare.', { kind: 'claude' })] }),
    );

    expect(search(store, 'worker')).toHaveLength(1);
  });

  /**
   * The phase gate, as nearly as a unit test can put it.
   *
   * **The words from the question, not the sentence.** Every term has to appear — the expression is
   * an implicit AND, which is what a search box does and what makes two words narrow rather than
   * widen. Typing the whole English question would require the transcript to contain "where" and
   * "did" too, which is a sentence nobody wrote.
   */
  it('answers the gate’s own question from the words in it', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('push the cloudflare workers deploy')] }));
    store.indexTranscript(
      batch({ sessionId: OTHER, path: 'C:\\other.jsonl', excerpts: [prose('rename the button')] }),
    );

    const hits = search(store, 'cloudflare workers deploy');

    expect(hits.map((hit) => hit.sessionId)).toEqual([SESSION]);
  });

  // The last token is a prefix, which is what makes a search narrow while it is being typed.
  it.each(['clo', 'cloud', 'cloudfl'])('matches on the prefix %s', (typed) => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare')] }));

    expect(search(store, typed)).toHaveLength(1);
  });

  it('is case-insensitive, because nobody remembers how they capitalised it', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('Cloudflare Workers')] }));

    expect(search(store, 'CLOUDFLARE')).toHaveLength(1);
  });

  /**
   * `remove_diacritics 2` — the corpus has German UI strings in it.
   *
   * It folds a diacritic and nothing else: `ä` is `a`, and `ß` is NOT `ss`, so `Große` is found by
   * `große` and not by `grosse`. Worth a test that says which, because assuming the second is how
   * somebody concludes the tokenizer is broken.
   */
  it('folds diacritics, so andern finds ändern', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('die Größe ändern')] }));

    expect(search(store, 'andern')).toHaveLength(1);
    expect(search(store, 'grosse')).toEqual([]);
  });

  it('needs every word, so two terms narrow rather than widen', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare deploy')] }));
    store.indexTranscript(
      batch({ sessionId: OTHER, path: 'C:\\b.jsonl', excerpts: [prose('cloudflare pages')] }),
    );

    expect(search(store, 'cloudflare deploy').map((hit) => hit.sessionId)).toEqual([SESSION]);
  });

  it('finds nothing for a word nobody wrote', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare')] }));

    expect(search(store, 'kubernetes')).toEqual([]);
  });
});

describe('the FTS5 index — what comes back', () => {
  /**
   * One hit per session, which is the query's whole shape.
   *
   * The gate asks *where* something was done, and the answer is a conversation to go back to.
   * Forty lines from inside one session would push every other session off the page.
   */
  it('answers once per session however many lines matched', () => {
    const store = open();
    store.indexTranscript(
      batch({
        excerpts: [prose('cloudflare one'), prose('cloudflare two'), prose('cloudflare three')],
      }),
    );

    expect(search(store, 'cloudflare')).toHaveLength(1);
  });

  // A session id is unique only within a config directory (`sessionKey`), so the same uuid under
  // the other account is a different conversation and must be a second hit.
  it('treats the same uuid on the other subscription as a different session', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare')] }));
    store.indexTranscript(
      batch({ subscription: 'isg', path: 'C:\\isg.jsonl', excerpts: [prose('cloudflare')] }),
    );

    expect(search(store, 'cloudflare')).toHaveLength(2);
  });

  it('carries the project and the instant, so a row can be drawn without a second read', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare', { at: 1_700_000 })] }));

    expect(search(store, 'cloudflare')[0]).toMatchObject({ projectKey: 'C--work', at: 1_700_000 });
  });

  // A turn may be 8 KB and the deck draws a row. `snippet()` returns the window around the match.
  it('answers with a window around the match rather than the whole turn', () => {
    const store = open();
    const long = `${'padding words '.repeat(200)}cloudflare${' more words'.repeat(200)}`;
    store.indexTranscript(batch({ excerpts: [prose(long)] }));

    const snippet = search(store, 'cloudflare')[0]?.snippet ?? '';

    expect(snippet.length).toBeLessThan(long.length);
    expect(snippet).toContain('cloudflare');
  });

  // The snippet is a React text node and never markup (SEC-UI-2), so it carries no highlight
  // markers — a `<b>` here would be a string out of a transcript tempting somebody to interpret it.
  it('puts no markup in the snippet', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('deploy to cloudflare now')] }));

    expect(search(store, 'cloudflare')[0]?.snippet).not.toMatch(/[<>]/u);
  });

  it('honours the limit, so one request cannot drag the whole index back', () => {
    const store = open();
    for (let index = 0; index < 5; index += 1) {
      store.indexTranscript(
        batch({
          sessionId: `${String(index)}aaaaaaa-0000-0000-0000-000000000000`,
          path: `C:\\${String(index)}.jsonl`,
          excerpts: [prose('cloudflare')],
        }),
      );
    }

    expect(search(store, 'cloudflare', 2)).toHaveLength(2);
  });
});

describe('the FTS5 index — the cursor', () => {
  it('answers nothing for a transcript it has never read', () => {
    expect(open().transcriptCursor('C:\\nothing.jsonl')).toBeUndefined();
  });

  it('remembers where reading stopped, and which file that was', () => {
    const store = open();
    store.indexTranscript(batch({ cursor: { offset: 4096, identity: 'dev:7:2026' } }));

    expect(store.transcriptCursor(batch().path)).toEqual({ offset: 4096, identity: 'dev:7:2026' });
  });

  // The whole point of the feature: a restart must not re-read 1.2 GB.
  it('survives the store being closed and reopened', () => {
    const first = open();
    first.indexTranscript(batch({ cursor: { offset: 4096, identity: 'dev:7:2026' } }));
    first.close();

    expect(open().transcriptCursor(batch().path)?.offset).toBe(4096);
  });

  it('moves the cursor rather than adding a second row for the same file', () => {
    const store = open();
    store.indexTranscript(batch({ cursor: { offset: 100, identity: 'dev:1:2026' } }));
    store.indexTranscript(batch({ cursor: { offset: 200, identity: 'dev:1:2026' } }));

    expect(store.transcriptCursor(batch().path)?.offset).toBe(200);
  });
});

describe('the FTS5 index — a transcript that was replaced', () => {
  /**
   * A resumed session writes a fresh transcript at a path already indexed.
   *
   * Everything held from the old one describes a conversation that is no longer there, and a
   * search that returned it would read as a bug in the search rather than in the index. The
   * external-content index has to lose it too — which is what the delete trigger is for, and what
   * a contentless one could not do, because it cannot read the old text back.
   */
  it('drops what it held, from the table AND from the index', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('the old cloudflare session')] }));

    store.indexTranscript(batch({ restarted: true, excerpts: [prose('a new conversation')] }));

    expect(search(store, 'cloudflare')).toEqual([]);
    expect(search(store, 'conversation')).toHaveLength(1);
  });

  it('leaves another session alone', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare here')] }));
    store.indexTranscript(
      batch({ sessionId: OTHER, path: 'C:\\b.jsonl', excerpts: [prose('cloudflare there')] }),
    );

    store.indexTranscript(batch({ restarted: true, excerpts: [prose('fresh')] }));

    expect(search(store, 'cloudflare').map((hit) => hit.sessionId)).toEqual([OTHER]);
  });
});

describe('the FTS5 index — the transaction', () => {
  // Half of a batch is a lie: excerpts without their cursor are indexed twice on the next pass,
  // and a cursor without its excerpts is text that is never searchable and never read again.
  it('stores the excerpts and the cursor together', () => {
    const store = open();

    store.indexTranscript(
      batch({ excerpts: [prose('cloudflare')], cursor: { offset: 77, identity: 'dev:1:2026' } }),
    );

    expect(search(store, 'cloudflare')).toHaveLength(1);
    expect(store.transcriptCursor(batch().path)?.offset).toBe(77);
  });

  // `at` is ordered on, and NULL would sort a line with no instant above every one that has one.
  it('stores a line with no timestamp as zero rather than as nothing', () => {
    const store = open();
    store.indexTranscript(batch({ excerpts: [prose('cloudflare', { at: undefined })] }));

    expect(search(store, 'cloudflare')[0]?.at).toBe(0);
  });

  it('stores a pass that read nothing, so the cursor still moves past what it skipped', () => {
    const store = open();

    store.indexTranscript(batch({ excerpts: [], cursor: { offset: 900, identity: 'dev:1:2026' } }));

    expect(store.transcriptCursor(batch().path)?.offset).toBe(900);
  });
});

// The fixture core's transcript search — P7-T2.
//
// **The REAL route over the REAL index**, not a list the double filters by hand. `SearchRoute`,
// `SearchToolsRoute` and `SqliteStore` are imported from core and run against a database in the
// smoke's own temp directory, so the FTS5 tokenizer, the ranking, the one-hit-per-session grouping,
// all five filters and the 400 for a malformed one are core's own code on the far side of the
// rewrite. What is fixture is only the corpus below and the indexer's progress — the indexer walks
// `~/.claude*`, which a smoke must never read.
//
// The corpus is hand-written and holds no transcript text from anywhere: five made-up turns, three
// of which answer the phase gate's question, in the fixture's own two folders.
import { join } from 'node:path';
import { SqliteStore } from '../../core/adapters/sqlite/sqlite-store.ts';
import { SearchRoute } from '../../core/http/search-route.ts';
import { SearchToolsRoute } from '../../core/http/search-tools-route.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The live, attachable ledger session in deck.json — a hit on it offers "open pane". */
export const LIVE_HIT = 'a1b2c3d4-0000-4000-8000-000000000001';
/** A ledger session the deck no longer lists — a hit on it offers the resume command, with `cd`. */
export const GONE_HIT = '5e55a0e1-0000-4000-8000-000000000011';
/** An isg session in an atlas WORKTREE, forty-five days old — "older than 30 days" finds it alone. */
export const OLD_HIT = '6e55a0e2-0000-4000-8000-000000000012';
/** Says `cloudflare` but not `workers deploy`, so the gate's words must leave it out. */
export const NEAR_MISS = '7e55a0e3-0000-4000-8000-000000000013';

const LEDGER_SLUG = 'C--Users-owner-Documents-ledger';
const ATLAS_TREE_SLUG = 'C--Users-owner-Documents-atlas--claude-worktrees-t1';

/** Mid-backfill: what the first live boot looked like (RESEARCH.md G.56), scaled down. */
export const FILLING = {
  transcripts: 40,
  behind: 12,
  bytesTotal: 800_000_000,
  bytesIndexed: 300_000_000,
};

export class FixtureSearch {
  constructor() {
    this.store = undefined;
    /** What `TranscriptIndexer.progress` would say. The checks move it to "caught up". */
    this.progress = { passedAt: Date.now(), ...FILLING };
    /** Every query string `/search` was asked, in order. */
    this.asked = [];
    this.search = undefined;
    this.tools = undefined;
  }

  /** Opens the index in `directory` — the smoke's temp dir, never `%LOCALAPPDATA%`. */
  start(directory) {
    this.store = new SqliteStore(join(directory, 'search.db'));
    this.search = new SearchRoute(this.store, { progress: () => this.progress });
    this.tools = new SearchToolsRoute(this.store);
    const now = Date.now();
    for (const batch of corpus(now)) this.store.indexTranscript(batch);
  }

  close() {
    this.store?.close();
  }

  caughtUp() {
    this.progress = {
      passedAt: Date.now(),
      transcripts: FILLING.transcripts,
      behind: 0,
      bytesTotal: FILLING.bytesTotal,
      bytesIndexed: FILLING.bytesTotal,
    };
  }

  /** @returns `[status, body]`, or `undefined` for a path that is not the search's. */
  async answer(request, url) {
    if (request.method !== 'GET') return undefined;
    if (url.pathname === '/search') {
      this.asked.push(url.search);
      const reply = await this.search.handle({ method: 'GET', url: request.url, headers: {} });
      return [reply.status, reply.body];
    }
    if (url.pathname === '/search/tools') {
      const reply = await this.tools.handle();
      return [reply.status, reply.body];
    }
    return undefined;
  }
}

function corpus(now) {
  return [
    batch(
      LIVE_HIT,
      '365',
      LEDGER_SLUG,
      ['Bash'],
      [prose('you', 'push the cloudflare workers deploy for the ledger api', now - 2 * HOUR_MS)],
    ),
    batch(
      GONE_HIT,
      '365',
      LEDGER_SLUG,
      ['Bash', 'Read'],
      [
        prose('you', 'roll back the cloudflare workers deploy from friday', now - 10 * DAY_MS),
        prose('claude', 'Rolled back: wrangler deploy reverted the worker.', now - 10 * DAY_MS),
      ],
    ),
    batch(
      OLD_HIT,
      'isg',
      ATLAS_TREE_SLUG,
      ['Bash', 'WebFetch'],
      [prose('claude', 'The workers deploy to Cloudflare finished cleanly.', now - 45 * DAY_MS)],
    ),
    batch(
      NEAR_MISS,
      'isg',
      LEDGER_SLUG,
      ['Edit'],
      [prose('you', 'cloudflare pages preview is broken', now - 3 * DAY_MS)],
    ),
    batch(
      '8e55a0e4-0000-4000-8000-000000000014',
      '365',
      LEDGER_SLUG,
      ['Edit'],
      [prose('you', 'rename the invoice button', now - DAY_MS)],
    ),
  ];
}

function batch(sessionId, subscription, projectKey, tools, excerpts) {
  return {
    path: `fixture\\${subscription}\\${projectKey}\\${sessionId}.jsonl`,
    subscription,
    sessionId,
    projectKey,
    cursor: { offset: 1, identity: 'fixture' },
    at: Date.now(),
    restarted: false,
    excerpts,
    tools,
  };
}

function prose(kind, text, at) {
  return { kind, text, at };
}

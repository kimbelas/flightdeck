// The search's client state, without a browser — P7-T2, CODING-STANDARDS §10.4.
//
// The two behaviours that make "under a second" felt rather than measured: a word being typed is
// one request, not one per keystroke, and a slow reply to an older request never overwrites a
// newer one.
import { describe, expect, it } from 'vitest';
import { CORE_SEARCH_PATH, CORE_SEARCH_TOOLS_PATH } from '../../contracts/deck-routes.ts';
import type { IndexProgress } from '../../contracts/search-reply.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import type { DeckApi, JsonReply } from '../../app/deck/deck-api.ts';
import {
  filtersFor,
  NO_CHOICE,
  TranscriptSearchStore,
  TYPING_PAUSE_MS,
  type SearchClock,
} from '../../app/deck/transcript-search-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const HIT: SearchHit = {
  subscription: '365',
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectKey: 'C--work',
  kind: 'you',
  at: NOW - DAY,
  snippet: 'deploy to cloudflare workers',
};

const PROGRESS: IndexProgress = {
  passedAt: NOW,
  transcripts: 10,
  behind: 2,
  bytesTotal: 1000,
  bytesIndexed: 400,
};

/** A timer the test fires by hand, and a clock that moves only when told. */
class ManualClock implements SearchClock {
  public at = NOW;
  private readonly pending: { readonly due: number; readonly task: () => void }[] = [];

  public now(): number {
    return this.at;
  }

  public wait(ms: number, task: () => void): () => void {
    const entry = { due: this.at + ms, task };
    this.pending.push(entry);
    return () => {
      const index = this.pending.indexOf(entry);
      if (index !== -1) this.pending.splice(index, 1);
    };
  }

  public advance(ms: number): void {
    this.at += ms;
    for (const entry of [...this.pending]) {
      if (entry.due > this.at) continue;
      this.pending.splice(this.pending.indexOf(entry), 1);
      entry.task();
    }
  }
}

function build(): { store: TranscriptSearchStore; api: FakeDeckApi; clock: ManualClock } {
  const api = new FakeDeckApi();
  const clock = new ManualClock();
  api.willAnswer(200, { hits: [HIT], index: PROGRESS });
  return { store: new TranscriptSearchStore(api, clock), api, clock };
}

function searches(api: FakeDeckApi): readonly string[] {
  return api.requests.map((request) => request.path).filter((path) => path.startsWith(`${CORE_SEARCH_PATH}?`)); // prettier-ignore
}

/** Lets the store's awaited `get` resolve. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TranscriptSearchStore — opening', () => {
  it('reads the tool list and the index progress before anything is typed', async () => {
    const { store, api } = build();
    api.willAnswerPath(CORE_SEARCH_TOOLS_PATH, 200, { tools: ['Bash', 'WebFetch'] });

    await store.open();

    expect(store.snapshot().tools).toEqual(['Bash', 'WebFetch']);
    expect(store.snapshot().index).toEqual(PROGRESS);
    expect(store.snapshot().status).toBe('idle');
    expect(searches(api)).toEqual([`${CORE_SEARCH_PATH}?q=`]);
  });
});

describe('TranscriptSearchStore — typing', () => {
  it('waits for a pause, then asks once for what was typed', async () => {
    const { store, api, clock } = build();

    store.type('c');
    store.type('cl');
    store.type('cloudflare');
    expect(searches(api)).toEqual([]);
    clock.advance(TYPING_PAUSE_MS);
    await settle();

    expect(searches(api)).toEqual([`${CORE_SEARCH_PATH}?q=cloudflare`]);
    expect(store.snapshot()).toMatchObject({ status: 'done', hits: [HIT] });
  });

  it('times the round trip, so "under a second" is on screen', async () => {
    const { store, clock } = build();
    store.type('cloudflare');
    clock.advance(TYPING_PAUSE_MS);
    await settle();

    expect(store.snapshot().tookMs).toBe(0);
  });

  it('drops a reply that arrives after a newer request went out', async () => {
    const api = new SlowFirstApi();
    const store = new TranscriptSearchStore(api, new ManualClock());

    const older = store.search();
    await store.choose({ subscription: 'isg' });
    api.releaseFirst();
    await older;

    expect(store.snapshot().hits).toEqual([]);
  });

  it('says it failed when core does not answer, rather than showing no hits as an answer', async () => {
    const { store, api } = build();
    api.willNotAnswer();

    store.type('cloudflare');
    await store.search();

    expect(store.snapshot().status).toBe('failed');
  });
});

describe('TranscriptSearchStore — filters', () => {
  it('searches at once when a filter changes, and cancels the typing pause', async () => {
    const { store, api, clock } = build();
    store.type('deploy');

    await store.choose({ tool: 'Bash' });
    clock.advance(TYPING_PAUSE_MS);
    await settle();

    expect(searches(api)).toEqual([`${CORE_SEARCH_PATH}?q=deploy&tool=Bash`]);
  });

  it('clears every filter and keeps the query', async () => {
    const { store } = build();
    store.type('deploy');
    await store.choose({ tool: 'Bash', session: 'aaaaaaaa', range: 'week' });

    await store.clearFilters();

    expect(store.snapshot().choice).toEqual({ ...NO_CHOICE, query: 'deploy' });
  });
});

describe('filtersFor', () => {
  it.each([
    ['any', undefined, undefined],
    ['day', NOW - DAY, undefined],
    ['week', NOW - 7 * DAY, undefined],
    ['month', NOW - 30 * DAY, undefined],
    // The range `cleanupPeriodDays` has deleted from disk and the index still holds.
    ['older', undefined, NOW - 30 * DAY],
  ] as const)('turns %s into since %s and until %s', (range, since, until) => {
    expect(filtersFor({ ...NO_CHOICE, range }, NOW)).toMatchObject({ since, until });
  });
});

/** Holds the FIRST reply until told, and answers every later one at once with nothing. */
class SlowFirstApi implements DeckApi {
  private release: (() => void) | undefined;
  private calls = 0;

  public get(): Promise<JsonReply | undefined> {
    this.calls += 1;
    if (this.calls === 1) {
      return new Promise((resolve) => {
        this.release = () => {
          resolve({ status: 200, body: { hits: [HIT], index: PROGRESS } });
        };
      });
    }
    return Promise.resolve({ status: 200, body: { hits: [], index: PROGRESS } });
  }

  public post(): Promise<JsonReply | undefined> {
    return Promise.resolve(undefined);
  }

  public releaseFirst(): void {
    this.release?.();
  }
}

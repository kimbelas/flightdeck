// `expand` and `forget` — the deck's one request that is not the session table (P2-T4).
//
// Its own file, as the quota one is, and for the same reason: this is a REQUEST path and the other
// two files are about frames. The three things worth pinning are the ones a component would get
// wrong — that a second click while the first is in flight does not start a second request, that a
// collapse drops the detail so re-expanding re-reads, and that a detail is never rendered against a
// row it does not belong to.
import { describe, expect, it } from 'vitest';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { DeckApi, JsonReply } from '../../app/deck/deck-api.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const REF: SessionRef = { sessionId: SESSION, shortId: 'cb5e8102', subscription: '365' };
const KEY = '365:cb5e8102-f057-4d5c-ad98-eac21a12f37d';

function detailBody(needs: string): Record<string, unknown> {
  return {
    sessionId: SESSION,
    at: 1_789_000_100_000,
    job: { state: 'blocked', needs },
    timeline: [],
    extras: { files: [] },
    tokenTrail: [],
  };
}

/** Records every path asked for, and answers what the test queued. */
class FakeApi implements DeckApi {
  public readonly gets: string[] = [];
  private readonly replies: (JsonReply | undefined)[];

  constructor(replies: (JsonReply | undefined)[]) {
    this.replies = replies;
  }

  public get(path: string): Promise<JsonReply | undefined> {
    this.gets.push(path);
    return Promise.resolve(this.replies[this.gets.length - 1] ?? this.replies.at(-1));
  }

  public post(): Promise<JsonReply | undefined> {
    return Promise.resolve(undefined);
  }
}

class SilentTransport implements StreamTransport {
  public open(): EventStreamSource {
    return {
      on: () => {
        // Nothing in this file arrives by frame.
      },
      close: () => {
        // Nothing to release.
      },
    };
  }

  public wait(): () => void {
    return () => {
      // No retry is exercised here.
    };
  }
}

function rig(replies: (JsonReply | undefined)[]): { store: DeckStore; api: FakeApi } {
  const api = new FakeApi(replies);
  return { store: new DeckStore(new SilentTransport(), api), api };
}

describe('DeckStore.expand', () => {
  it('asks the core route with all three identifying parameters', async () => {
    const { store, api } = rig([{ status: 200, body: detailBody('do a thing') }]);

    await store.expand(REF);

    expect(api.gets[0]).toContain('/api/core/session?');
    expect(api.gets[0]).toContain(`session=${SESSION}`);
    expect(api.gets[0]).toContain('short=cb5e8102');
    expect(api.gets[0]).toContain('subscription=365');
  });

  it('holds the parsed detail under the row`s key', async () => {
    const { store } = rig([{ status: 200, body: detailBody('do a thing') }]);

    await store.expand(REF);

    expect(store.snapshot().details[KEY]?.job?.needs).toBe('do a thing');
  });

  it('marks the key before it awaits, so the row can draw a spinner immediately', async () => {
    const { store } = rig([{ status: 200, body: detailBody('do a thing') }]);

    const pending = store.expand(REF);

    // Present with `undefined` — "asked, still waiting", which is a different state from absent.
    expect(KEY in store.snapshot().details).toBe(true);
    expect(store.snapshot().details[KEY]).toBeUndefined();
    await pending;
  });

  it('does not start a second request while the first is in flight', async () => {
    const { store, api } = rig([{ status: 200, body: detailBody('do a thing') }]);

    await Promise.all([store.expand(REF), store.expand(REF)]);

    expect(api.gets).toHaveLength(1);
  });

  it('leaves the row expanded with nothing rather than snapping shut when core refuses', async () => {
    const { store } = rig([{ status: 503, body: undefined }]);

    await store.expand(REF);

    expect(KEY in store.snapshot().details).toBe(true);
    expect(store.snapshot().details[KEY]).toBeUndefined();
  });

  it('survives a request that reached nobody', async () => {
    const { store } = rig([undefined]);

    await expect(store.expand(REF)).resolves.toBeUndefined();
    expect(store.snapshot().details[KEY]).toBeUndefined();
  });

  it('drops a 200 that is not a detail, exactly as it drops an unparseable frame', async () => {
    const { store } = rig([{ status: 200, body: { nothing: true } }]);

    await store.expand(REF);

    expect(store.snapshot().details[KEY]).toBeUndefined();
  });

  it('refuses a detail for a different session, which would render against the wrong row', async () => {
    // The one field `parseSessionDetail` requires is the session id, and this is why: an expansion
    // showing another session's attention text is worse than one that did not open.
    const other = {
      ...detailBody('do a thing'),
      sessionId: 'd1b2f43c-1111-4222-a333-444444444444',
    };
    const { store } = rig([{ status: 200, body: other }]);

    await store.expand(REF);

    expect(store.snapshot().details[KEY]).toBeUndefined();
  });
});

describe('DeckStore.forget', () => {
  it('drops the detail, so re-expanding is a fresh read', async () => {
    // `state.json` and `timeline.jsonl` move while a row is open. A detail from four minutes ago
    // that looks current is worse than a spinner.
    const { store, api } = rig([
      { status: 200, body: detailBody('first') },
      { status: 200, body: detailBody('second') },
    ]);
    await store.expand(REF);

    store.forget(KEY);
    await store.expand(REF);

    expect(api.gets).toHaveLength(2);
    expect(store.snapshot().details[KEY]?.job?.needs).toBe('second');
  });

  it('leaves the other open rows alone', async () => {
    const other: SessionRef = {
      sessionId: 'd1b2f43c-1111-4222-a333-444444444444',
      shortId: 'd1b2f43c',
      subscription: 'isg',
    };
    const { store } = rig([
      { status: 200, body: detailBody('first') },
      { status: 200, body: { ...detailBody('second'), sessionId: other.sessionId } },
    ]);
    await store.expand(REF);
    await store.expand(other);

    store.forget(KEY);

    expect(KEY in store.snapshot().details).toBe(false);
    expect(store.snapshot().details['isg:d1b2f43c-1111-4222-a333-444444444444']).toBeDefined();
  });

  it('is a no-op for a row nobody expanded', () => {
    const { store } = rig([]);

    expect(() => {
      store.forget(KEY);
    }).not.toThrow();
  });
});

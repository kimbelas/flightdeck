// The cost panel's fetch path, from the store's side — P7-T3.
import { describe, expect, it } from 'vitest';
import { CORE_SPEND_PATH } from '../../contracts/deck-routes.ts';
import type { SpendSummary } from '../../contracts/spend-summary.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

class IdleTransport implements StreamTransport {
  public open(): EventStreamSource {
    return { on: () => undefined, close: () => undefined };
  }

  public wait(): () => void {
    return () => undefined;
  }
}

function rig(): { store: DeckStore; api: FakeDeckApi } {
  const api = new FakeDeckApi();
  return { store: new DeckStore(new IdleTransport(), api), api };
}

const SUMMARY: SpendSummary = {
  at: 5,
  weeks: [{ weekStart: 1, subscriptions: [] }],
  projects: [],
  otherProjects: 0,
  coverage: { transcripts: 3, behind: 0, passes: 1 },
};

describe('DeckStore.spend', () => {
  it('holds nothing until it is asked', () => {
    const { store, api } = rig();

    expect(store.snapshot().spend).toEqual({ summary: undefined, reading: false, failed: false });
    expect(api.requests).toEqual([]);
  });

  it('asks core through the rewrite and holds the summary', async () => {
    const { store, api } = rig();
    api.willAnswer(200, SUMMARY);

    await store.spend.load();

    expect(api.requests).toEqual([{ method: 'GET', path: CORE_SPEND_PATH, body: undefined }]);
    expect(store.snapshot().spend).toEqual({ summary: SUMMARY, reading: false, failed: false });
  });

  it('is reading while the request is out, and a second press does not send a second', async () => {
    const { store, api } = rig();
    api.willAnswer(200, SUMMARY);

    const first = store.spend.load();
    expect(store.snapshot().spend.reading).toBe(true);
    await store.spend.load();
    await first;

    expect(api.requests).toHaveLength(1);
  });

  it('keeps the last summary when a re-read fails, and says it failed', async () => {
    const { store, api } = rig();
    api.willAnswer(200, SUMMARY);
    await store.spend.load();

    api.willNotAnswer();
    await store.spend.load();

    expect(store.snapshot().spend).toEqual({ summary: SUMMARY, reading: false, failed: true });
  });

  it('refuses an answer that is not a summary', async () => {
    const { store, api } = rig();
    api.willAnswer(200, '<html>not json</html>');

    await store.spend.load();

    expect(store.snapshot().spend).toEqual({ summary: undefined, reading: false, failed: true });
  });

  it('clears the failure once a read succeeds again', async () => {
    const { store, api } = rig();
    api.willAnswer(503, { error: 'down' });
    await store.spend.load();

    api.willAnswer(200, SUMMARY);
    await store.spend.load();

    expect(store.snapshot().spend.failed).toBe(false);
  });
});

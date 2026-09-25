// Adopting an ended interactive session, from the deck's side — P6-T7, SPEC §4.3.
//
// Its own file beside `deck-store-requests.test.ts`, which is at its line limit: the store's verbs
// have been split this way since P6-T3 (`deck-store-mutes.test.ts`), and this is one verb.
//
// The question underneath every case is the one the pair raises. `resume` and `adopt` send the
// same two fields to two different paths, so the way to get this wrong is to send an adoption down
// the resume route — which would answer 200, start the session in core's own folder, and look
// exactly like it worked (RESEARCH.md G.55).
import { describe, expect, it } from 'vitest';
import { CORE_ADOPT_PATH, CORE_RESUME_PATH } from '../../contracts/deck-routes.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const ROW: SessionRow = {
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shortId: 'aaaaaaaa',
  subscription: '365',
  kind: 'interactive',
  name: 'apex',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: false,
  runState: undefined,
  status: undefined,
  attachable: false,
  notAttachableBecause: 'That terminal has closed.',
  endReason: 'unknown',
  retireReason: undefined,
};

/** The stream is not under test here, so the transport does nothing and is never connected. */
class IdleTransport implements StreamTransport {
  public open(): EventStreamSource {
    return { on: () => undefined, close: () => undefined };
  }

  public wait(): () => void {
    return () => undefined;
  }
}

function snapshot(rows: readonly SessionRow[]): unknown {
  return { rows, unreadable: [], takenAt: 1 };
}

function rig(): { store: DeckStore; api: FakeDeckApi } {
  const api = new FakeDeckApi();
  return { store: new DeckStore(new IdleTransport(), api), api };
}

/**
 * Adopting an ended interactive session — P6-T7, SPEC §4.3.
 *
 * `resume`'s twin, and the pair is what these cases are really about: the two verbs send the same
 * two fields to two different paths, so the way to get this wrong is to send an adoption down the
 * resume route — which would succeed, start the session in core's own folder, and look fine.
 */
describe('DeckStore.adopt', () => {
  const REF = {
    sessionId: ROW.sessionId,
    shortId: ROW.shortId,
    subscription: ROW.subscription,
  };

  it('posts the ref to the adopt route, which is not the resume route', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { sessionId: ROW.sessionId });

    expect(await store.adopt(REF)).toBe(true);
    expect(api.requests[0]?.path).toBe(CORE_ADOPT_PATH);
    expect(api.requests[0]?.path).not.toBe(CORE_RESUME_PATH);
    expect(api.requests[0]?.body).toEqual(REF);
  });

  // The folder is core's to look up. A deck that sent one would be choosing the directory a
  // process starts in, which is what SEC-FS-1 exists to prevent.
  it('sends no folder, because core reads that off the machine', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { sessionId: ROW.sessionId });

    await store.adopt(REF);

    expect(api.requests[0]?.body).not.toHaveProperty('cwd');
  });

  // The adopted session comes back on the next sweep as a background row. Editing the row here
  // would be the deck guessing at the outcome of a write — `remove`'s rule, one verb over.
  it('does not change the row itself', async () => {
    const { store, api } = rig();
    api.willAnswer(200, snapshot([{ ...ROW, kind: 'interactive', live: false }]));
    await store.refresh();

    api.willAnswer(200, { sessionId: ROW.sessionId });
    await store.adopt(REF);

    expect(store.snapshot().rows[0]).toMatchObject({ kind: 'interactive', live: false });
  });

  // Not a failure at all: the terminal is open, and the answer is to go and close it.
  it('says a still-open terminal is a thing to close, not an error to retry', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'still_running' });

    expect(await store.adopt(REF)).toBe(false);
    expect(store.snapshot().error).toBe('That terminal is still open. Close it, then adopt it.');
  });

  it('says core has forgotten where it was, rather than naming the code', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'not_adoptable' });

    expect(await store.adopt(REF)).toBe(false);
    expect(store.snapshot().error).toContain('no longer knows where');
  });

  // 503 read as "core is not running" is precisely wrong: core answered, and it is the operator's
  // problem rather than the request's.
  it('reads a 503 as core being up and unable to find claude.exe', async () => {
    const { store, api } = rig();
    api.willAnswer(503, { error: 'no_claude' });

    expect(await store.adopt(REF)).toBe(false);
    expect(store.snapshot().error).toContain('cannot find claude.exe');
  });

  it('reports a request that reached nobody', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    expect(await store.adopt(REF)).toBe(false);
    expect(store.snapshot().error).toBe('Could not reach flightdeck-core.');
  });
});

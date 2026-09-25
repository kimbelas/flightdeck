// Moving a live interactive session into Flightdeck, from the deck's side — P6-T8, D63.
//
// Two halves in one file, because they are one question asked twice: WHICH rows offer the button
// and when it can be pressed (the view model), and WHAT the press sends (the store). The way to
// get the second wrong is the one that matters — sending anything but the ref would let the page
// name the process core ends, or the folder it adopts in.
import { describe, expect, it } from 'vitest';
import { CORE_ADOPT_PATH, CORE_TAKEOVER_PATH } from '../../contracts/deck-routes.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { SessionRowViewModel } from '../../app/deck/session-row-view-model.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const ROW: SessionRow = {
  sessionId: 'e3cd988e-4179-4ba5-9bed-69dbac7c6e93',
  shortId: 'e3cd988e',
  subscription: '365',
  kind: 'interactive',
  name: 'ledger',
  cwd: 'C:\\work\\ledger',
  startedAt: 1000,
  live: true,
  runState: undefined,
  status: 'idle',
  attachable: false,
  notAttachableBecause: 'Interactive session — already bound to its own terminal.',
  endReason: 'unknown',
  retireReason: undefined,
};

function view(over: Partial<SessionRow> = {}): SessionRowViewModel {
  return new SessionRowViewModel({ ...ROW, ...over });
}

describe('SessionRowViewModel — moving a live session here (P6-T8)', () => {
  it('offers it on a live interactive session, and it can be pressed when idle', () => {
    expect(view().canTakeOver).toBe(true);
    expect(view().takeOverReady).toBe(true);
  });

  // Offered, not pressable: the constraint is temporary, and the title says what it waits for.
  it.each(['busy', 'waiting', undefined] as const)(
    'offers it but holds it while the status is %s',
    (status) => {
      const row = view({ status });

      expect(row.canTakeOver).toBe(true);
      expect(row.takeOverReady).toBe(false);
      expect(row.takeOverHint).toMatch(/once this turn finishes/u);
    },
  );

  // An ended one is `adopt`'s, and a background one is already attachable.
  it.each([
    { kind: 'interactive', live: false },
    { kind: 'background', live: true },
    { kind: 'background', live: false },
  ] as const)('does not offer it on $kind with live $live', (over) => {
    expect(view(over).canTakeOver).toBe(false);
  });

  it('never offers both adopt and move on one row', () => {
    for (const kind of ['interactive', 'background'] as const) {
      for (const live of [true, false]) {
        const row = view({ kind, live });

        expect(row.canTakeOver && row.canAdopt).toBe(false);
      }
    }
  });

  // The armed sentence names both costs: the window closes, and the session is renamed.
  it('warns that the terminal closes and names what the session will be called', () => {
    const warning = view().takeOverWarning;

    expect(warning).toMatch(/closes/u);
    expect(warning).toContain('e3cd988e');
  });
});

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

describe('DeckStore.takeOver', () => {
  const REF = { sessionId: ROW.sessionId, shortId: ROW.shortId, subscription: ROW.subscription };

  it('posts the ref, and only the ref, to the takeover route', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { sessionId: ROW.sessionId });

    expect(await store.takeOver(REF)).toBe(true);
    expect(api.requests[0]?.path).toBe(CORE_TAKEOVER_PATH);
    expect(api.requests[0]?.path).not.toBe(CORE_ADOPT_PATH);
    expect(api.requests[0]?.body).toEqual(REF);
  });

  it('says a session that started working was left alone', async () => {
    const { store, api } = rig();
    api.willAnswer(409, { error: 'busy' });

    expect(await store.takeOver(REF)).toBe(false);
    expect(store.snapshot().error).toMatch(/left alone/u);
  });

  it('points an adoption that failed after the close at the adopt button', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'adopt_failed' });

    expect(await store.takeOver(REF)).toBe(false);
    expect(store.snapshot().error).toMatch(/Adopt it from its row/u);
  });

  it.each([
    { error: 'not_running', text: /already ended/u },
    { error: 'end_failed', text: /Nothing was moved/u },
    { error: 'no_folder', text: /left alone/u },
  ])('has a sentence for $error', async ({ error, text }) => {
    const { store, api } = rig();
    api.willAnswer(400, { error });

    await store.takeOver(REF);

    expect(store.snapshot().error).toMatch(text);
  });

  it('reads a 503 as core being up and unable to find claude.exe', async () => {
    const { store, api } = rig();
    api.willAnswer(503, { error: 'no_claude' });

    await store.takeOver(REF);

    expect(store.snapshot().error).toContain('cannot find claude.exe');
  });
});

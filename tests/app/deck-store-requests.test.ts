// The two things the deck asks for rather than waits for — P2-T2.
//
// A separate file from deck-store.test.ts, which owns the stream. These are the paths that had no
// test at all until this task, because the store called `fetch` directly and there was nothing to
// inject. That is also why they were the paths that skipped parsing: an untested path is where a
// cast survives.
//
// The assertions worth reading twice are the ones about a reply that is well-formed HTTP and
// malformed everything else — a 200 carrying a Next error page, a 201 with no id. Both used to
// land in state and render.
import { describe, expect, it } from 'vitest';
import {
  CORE_PROJECT_STATUS_PATH,
  CORE_PROJECTS_PATH,
  CORE_SESSIONS_PATH,
} from '../../contracts/deck-routes.ts';
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
  kind: 'background',
  name: 'fd-one',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: true,
  runState: 'working',
  status: undefined,
  attachable: true,
  notAttachableBecause: undefined,
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

function rig(): { store: DeckStore; api: FakeDeckApi } {
  const api = new FakeDeckApi();
  return { store: new DeckStore(new IdleTransport(), api), api };
}

/** `unknown[]` on purpose: half the point here is what a malformed row does to a whole sweep. */
function snapshot(rows: readonly unknown[], unreadable: readonly string[] = []): unknown {
  return { rows, unreadable, takenAt: 1 };
}

describe('DeckStore.refresh', () => {
  it('asks through the rewrite, never core directly', async () => {
    const { store, api } = rig();
    api.willAnswer(200, snapshot([]));

    await store.refresh();

    // The registry rides along (P3-T2): it has no stream frame, so a deliberate refresh is the
    // only thing that can move it. Every path still goes through the rewrite.
    expect(api.requests.map((request) => request.path)).toEqual([
      CORE_SESSIONS_PATH,
      CORE_PROJECTS_PATH,
      CORE_PROJECT_STATUS_PATH,
    ]);
    expect(api.requests.every((request) => request.path.startsWith('/api/core/'))).toBe(true);
  });

  it('takes the rows and the unreadable subscriptions, and says core is up', async () => {
    const { store, api } = rig();
    api.willAnswer(200, snapshot([ROW], ['isg']));

    await store.refresh();

    expect(store.snapshot().rows).toEqual([ROW]);
    expect(store.snapshot().unreadable).toEqual(['isg']);
    expect(store.snapshot().coreUp).toBe(true);
    expect(store.snapshot().loading).toBe(false);
  });

  it('drops a row that does not parse and keeps the rest of the sweep', async () => {
    // One malformed row must not cost the deck the other nine, or the `unreadable` list with them.
    const { store, api } = rig();
    api.willAnswer(200, snapshot([ROW, { sessionId: 'half-a-row' }], ['isg']));

    await store.refresh();

    expect(store.snapshot().rows).toEqual([ROW]);
    expect(store.snapshot().unreadable).toEqual(['isg']);
  });

  it('refuses a 200 that is not a snapshot rather than rendering an empty deck', async () => {
    // Next answers its own errors as HTML with a 200 in some shapes; core answering something
    // unexpected looks identical from here. Neither is "no sessions".
    const { store, api } = rig();
    api.willAnswer(200, snapshot([ROW]));
    await store.refresh();

    api.willAnswer(200, '<!doctype html><h1>Application error</h1>');
    await store.refresh();

    expect(store.snapshot().error).toBe(
      'flightdeck-core answered something the deck could not read.',
    );
    // The rows stay: what core last said is still the best answer anyone has.
    expect(store.snapshot().rows).toEqual([ROW]);
  });

  it('names core being down, because 503 is what the deck sees when it is', async () => {
    const { store, api } = rig();
    api.willAnswer(503, undefined);

    await store.refresh();

    expect(store.snapshot().coreUp).toBe(false);
    expect(store.snapshot().error).toBe('flightdeck-core is not running.');
  });

  it('says to restart core on a refusal, because the token is per boot', async () => {
    const { store, api } = rig();
    api.willAnswer(401, { error: 'unauthorized' });

    await store.refresh();

    expect(store.snapshot().error).toBe(
      'Core refused the request — restart it to reissue the token.',
    );
  });

  it('reports a request that reached nobody', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    await store.refresh();

    expect(store.snapshot().coreUp).toBe(false);
    expect(store.snapshot().error).toBe('Could not reach flightdeck-core.');
  });

  it('stops loading however it ends', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    await store.refresh();

    expect(store.snapshot().loading).toBe(false);
  });
});

describe('DeckStore.launch', () => {
  it('posts what core asks for, and nothing the page made up', async () => {
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: ROW.sessionId });

    await store.launch('365', 'do the thing', 'fd-one');

    expect(api.requests).toEqual([
      {
        method: 'POST',
        path: CORE_SESSIONS_PATH,
        body: { subscription: '365', prompt: 'do the thing', name: 'fd-one' },
      },
    ]);
  });

  it('returns the new id so a pane can be opened on it', async () => {
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: ROW.sessionId });

    expect(await store.launch('365', 'do the thing', undefined)).toBe(ROW.sessionId);
    expect(store.snapshot().error).toBeUndefined();
  });

  it('does not add a row itself — the reconciler publishes it on the stream', async () => {
    // A launch that put its own row in would be the deck disagreeing with core about what exists,
    // which is exactly the two-sweep case P1-T4 exists for (RESEARCH.md G.2).
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: ROW.sessionId });

    await store.launch('365', 'do the thing', undefined);

    expect(store.snapshot().rows).toEqual([]);
  });

  it('refuses a 201 with no session id rather than returning an empty one', async () => {
    // An empty id reaches the pane registry as a key that matches nothing, and presents as a pane
    // that silently never connects.
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: '' });

    expect(await store.launch('365', 'do the thing', undefined)).toBeUndefined();
    expect(store.snapshot().error).toBe(
      'flightdeck-core answered something the deck could not read.',
    );
  });

  it('treats anything but 201 as not started, including a 200', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { sessionId: ROW.sessionId });

    expect(await store.launch('365', 'do the thing', undefined)).toBeUndefined();
    expect(store.snapshot().error).toBe('Core answered 200.');
  });

  it('names the one failure that is the operator’s to fix, not the status it came under', async () => {
    // `no_claude` is a 503, and a 503 otherwise reads as "core is not running" — which is exactly
    // wrong here: core is running, it answered, and it cannot find claude.exe (LaunchRoute).
    const { store, api } = rig();
    api.willAnswer(503, { error: 'no_claude' });

    expect(await store.launch('365', 'do the thing', undefined)).toBeUndefined();
    expect(store.snapshot().error).toBe(
      'Core is running but cannot find claude.exe — run `npm run doctor`.',
    );
  });

  it('does not repeat core’s other codes at the owner, who cannot act on them', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'launch_failed' });

    expect(await store.launch('365', 'do the thing', undefined)).toBeUndefined();
    expect(store.snapshot().error).toBe('Core would not start that session.');
  });

  it('reports a request that reached nobody', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    expect(await store.launch('365', 'do the thing', undefined)).toBeUndefined();
    expect(store.snapshot().error).toBe('Could not reach flightdeck-core.');
    expect(store.snapshot().loading).toBe(false);
  });

  it('does not claim core is down when only the launch failed', async () => {
    // The stream is the authority on `coreUp`; a rejected launch says nothing about it.
    const { store, api } = rig();
    api.willAnswer(200, snapshot([ROW]));
    await store.refresh();

    api.willAnswer(400, { error: 'bad request' });
    await store.launch('365', '', undefined);

    expect(store.snapshot().coreUp).toBe(true);
  });
});

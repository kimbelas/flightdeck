// The deck's copy of the mute set — P6-T3.
//
// One question, asked from several sides: does the page ever believe in a mute core did not
// confirm? It must not, because the switch on a pane is a promise about what happens at 2 a.m.
// with this page closed, and that is core's business entirely.
import { describe, expect, it } from 'vitest';
import { CORE_MUTES_PATH } from '../../contracts/deck-routes.ts';
import { MuteSlice } from '../../app/deck/mute-slice.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const SESSION_ID = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const KEY = `365:${SESSION_ID}`;

interface Built {
  readonly api: FakeDeckApi;
  readonly slice: MuteSlice;
  readonly published: string[][];
}

function build(): Built {
  const api = new FakeDeckApi();
  const published: string[][] = [];
  const slice = new MuteSlice(api, (muted) => published.push([...muted]));
  return { api, slice, published };
}

describe('MuteSlice — reading', () => {
  it('reads the set core is working from, on the shared path', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, { muted: [KEY] });

    await slice.load();

    expect(api.requests).toEqual([{ method: 'GET', path: CORE_MUTES_PATH, body: undefined }]);
    expect(published).toEqual([[KEY]]);
  });

  // "We could not ask" is not "nothing is muted". A core that is down is an ordinary state the
  // deck renders (F.3.3), and emptying the set would draw every switch in the wrong position.
  it('leaves the set alone when core cannot be reached', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, { muted: [KEY] });
    await slice.load();
    api.willNotAnswer();

    await slice.load();

    expect(published).toEqual([[KEY]]);
  });

  it.each([
    { status: 500, body: { muted: [] }, why: 'a 500' },
    { status: 200, body: '<!doctype html>', why: 'a 200 carrying something that is not JSON' },
    { status: 200, body: { muted: 'everything' }, why: 'a set that is not a list' },
    { status: 200, body: {}, why: 'a reply with no set in it' },
  ])('ignores $why', async ({ status, body }) => {
    const { api, slice, published } = build();
    api.willAnswer(200, { muted: [KEY] });
    await slice.load();
    api.willAnswer(status, body);

    await slice.load();

    expect(published).toEqual([[KEY]]);
  });
});

describe('MuteSlice — writing', () => {
  it('sends the position being asked for, not a toggle', async () => {
    const { api, slice } = build();
    api.willAnswer(200, { muted: [KEY] });

    await slice.set('365', SESSION_ID, true);

    expect(api.requests).toEqual([
      {
        method: 'POST',
        path: CORE_MUTES_PATH,
        body: { sessionId: SESSION_ID, subscription: '365', muted: true },
      },
    ]);
  });

  it('takes the whole set back rather than editing its own copy', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, { muted: [KEY, `isg:${SESSION_ID}`] });

    await slice.set('365', SESSION_ID, true);

    expect(published).toEqual([[KEY, `isg:${SESSION_ID}`]]);
  });

  /**
   * The failure the whole design is for.
   *
   * `MuteBook` answers with the set it actually holds, so a store that could not be written comes
   * back WITHOUT the mute that was just asked for. The page has to show that — the switch springs
   * back — because the alternative is a session the owner believes is silent and is not.
   */
  it('shows the switch springing back when core did not keep the mute', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, { muted: [] });

    await slice.set('365', SESSION_ID, true);

    expect(published).toEqual([[]]);
  });

  it('publishes nothing at all when the press reached nobody', async () => {
    const { api, slice, published } = build();
    api.willNotAnswer();

    await slice.set('365', SESSION_ID, true);

    expect(published).toEqual([]);
  });
});

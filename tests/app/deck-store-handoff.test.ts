// Pressing hand off — P6-T6, SPEC §6(8).
//
// The question underneath every case: can the deck ever be more confident than core was? This is
// the one verb that ADDS a session, so the two ways to be wrong are opposite and both bad — saying
// a fork was made when core refused, and saying it was refused when core made one. The second is
// worse: the fork is running, and a deck that says otherwise sends somebody to press again.
//
// Nothing here checks that the new row appears. It does not come from this reply and must not:
// it arrives on the stream a sweep later like every other row (`HandoffSlice`).
import { describe, expect, it } from 'vitest';
import { CORE_HANDOFF_PATH } from '../../contracts/deck-routes.ts';
import { HandoffSlice, type HandoffHeld } from '../../app/deck/handoff-slice.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const SESSION_ID = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const REF: SessionRef = { subscription: '365', sessionId: SESSION_ID, shortId: '337975f9' };
const KEY = `365:${SESSION_ID}`;
const TREE = String.raw`C:\Users\owner\Documents\XWEB-1853`;

interface Built {
  readonly api: FakeDeckApi;
  readonly slice: HandoffSlice;
  readonly published: Partial<HandoffHeld>[];
}

function build(): Built {
  const api = new FakeDeckApi();
  const published: Partial<HandoffHeld>[] = [];
  const slice = new HandoffSlice(api, (changes) => published.push(changes));
  return { api, slice, published };
}

describe('HandoffSlice — what it sends', () => {
  it('posts the ref, the folder and the name to the handoff path', async () => {
    const { api, slice } = build();
    api.willAnswer(201, { sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' });

    await slice.handOff(REF, TREE, 'fd-alpha-fork');

    expect(api.requests).toEqual([
      {
        method: 'POST',
        path: CORE_HANDOFF_PATH,
        body: {
          sessionId: SESSION_ID,
          shortId: '337975f9',
          subscription: '365',
          cwd: TREE,
          name: 'fd-alpha-fork',
        },
      },
    ]);
  });

  // The refusal on screen is about the press that just happened. A press that starts with last
  // week's sentence still under the form would be reporting the wrong failure.
  it('clears the last refusal before it posts, not after it answers', async () => {
    const { api, slice, published } = build();
    api.willAnswer(400, { error: 'bad_cwd' });
    await slice.handOff(REF, TREE, 'fd-alpha-fork');
    api.willAnswer(201, { sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' });

    await slice.handOff(REF, TREE, 'fd-alpha-fork');

    expect(published.at(-1)).toEqual({ handoffRefusal: undefined });
  });
});

describe('HandoffSlice — what it believes', () => {
  // 201 and nothing else. A handoff CREATES a session, which is the one thing that separates it
  // from a resume, and core answers 201 for exactly that reason (`HandoffRoute`).
  it('reports a fork only for a 201', async () => {
    const { api, slice } = build();
    api.willAnswer(201, { sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' });

    expect(await slice.handOff(REF, TREE, 'fd-alpha-fork')).toBe(true);
  });

  it.each([
    { status: 200, body: { sessionId: 'x' }, why: 'a 200, which this route never answers' },
    { status: 400, body: { error: 'bad_cwd' }, why: 'a refusal' },
    { status: 503, body: { error: 'no_claude' }, why: 'a core that cannot find Claude' },
  ])('does not report a fork for $why', async ({ status, body }) => {
    const { api, slice } = build();
    api.willAnswer(status, body);

    expect(await slice.handOff(REF, TREE, 'fd-alpha-fork')).toBe(false);
  });
});

describe('HandoffSlice — the refusal it keeps', () => {
  it('keeps core’s own code', async () => {
    const { api, slice, published } = build();
    api.willAnswer(400, { error: 'bad_name' });

    await slice.handOff(REF, TREE, 'fd-alpha-fork');

    expect(published.at(-1)).toEqual({ handoffRefusal: { key: KEY, code: 'bad_name' } });
  });

  // Several rows can be expanded at once. A code with no row on it would draw "that folder is
  // gone" under a session nobody pressed, which is a sentence that is false about that row.
  it('keys the refusal on the row that pressed, on BOTH ids', async () => {
    const { api, slice, published } = build();
    api.willAnswer(400, { error: 'bad_cwd' });

    await slice.handOff({ ...REF, subscription: 'isg' }, TREE, 'fd-alpha-fork');

    expect(published.at(-1)?.handoffRefusal?.key).toBe(`isg:${SESSION_ID}`);
  });

  // The honest fallback for a reply that never came: the fork may well have happened, and every
  // other code would claim to know something about why it did not.
  it.each([
    { reply: () => undefined, why: 'a core that is not listening' },
    { reply: () => ({ status: 500, body: '<!doctype html>' }), why: 'a 500 carrying HTML' },
    { reply: () => ({ status: 400, body: { error: 'nonsense' } }), why: 'a code nobody defined' },
    { reply: () => ({ status: 400, body: {} }), why: 'a body with no code in it' },
    { reply: () => ({ status: 400, body: [1, 2] }), why: 'a body that is a list' },
  ])('falls back to handoff_failed for $why', async ({ reply }) => {
    const { api, slice, published } = build();
    const answer = reply();
    if (answer === undefined) api.willNotAnswer();
    else api.willAnswer(answer.status, answer.body);

    expect(await slice.handOff(REF, TREE, 'fd-alpha-fork')).toBe(false);
    expect(published.at(-1)).toEqual({ handoffRefusal: { key: KEY, code: 'handoff_failed' } });
  });
});

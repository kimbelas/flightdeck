// The mute wire shapes — P6-T3.
//
// Two parsers, and they guard different directions. `parseMuteRequest` screens what a browser
// sends, so it refuses; `parseMuteState` reads what core answered, so it drops what it cannot read
// and keeps the rest — the asymmetry `parseSessionRow` and `parseSessionRefPayload` already have.
import { describe, expect, it } from 'vitest';
import { parseMuteRequest, parseMuteState } from '../../contracts/session-mute.ts';

const SESSION_ID = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('parseMuteRequest', () => {
  it('reads a request', () => {
    expect(parseMuteRequest({ sessionId: SESSION_ID, subscription: 'isg', muted: true })).toEqual({
      sessionId: SESSION_ID,
      subscription: 'isg',
      muted: true,
    });
  });

  it('reads an unmute, which is the same shape with the other boolean', () => {
    const parsed = parseMuteRequest({ sessionId: SESSION_ID, subscription: '365', muted: false });

    expect(parsed?.muted).toBe(false);
  });

  it.each([
    { over: { sessionId: '337975f9' }, why: 'a short id where a session id belongs' },
    { over: { sessionId: SESSION_ID.toUpperCase() }, why: 'an uppercase uuid' },
    { over: { sessionId: `${SESSION_ID}\\..\\daemon` }, why: 'a uuid with a path glued on' },
    { over: { subscription: 'personal' }, why: 'a subscription nobody has' },
    { over: { muted: 'yes' }, why: 'a mute spelled as a string' },
    { over: { muted: 1 }, why: 'a mute spelled as a number' },
  ])('refuses $why', ({ over }) => {
    expect(
      parseMuteRequest({ sessionId: SESSION_ID, subscription: '365', muted: true, ...over }),
    ).toBeUndefined();
  });

  it.each([
    { value: null, why: 'null' },
    { value: [], why: 'an array' },
    { value: 'muted', why: 'a string' },
    { value: 7, why: 'a number' },
    { value: {}, why: 'an empty object' },
  ])('refuses $why outright', ({ value }) => {
    expect(parseMuteRequest(value)).toBeUndefined();
  });

  // A short id is screened hard elsewhere because it names a job directory and reaches a command
  // line. Nothing here does either, so it is not asked for — and an extra field is not a reason to
  // refuse a request that is otherwise exactly right.
  it('does not want a short id, and does not mind being sent one', () => {
    const parsed = parseMuteRequest({
      sessionId: SESSION_ID,
      shortId: '337975f9',
      subscription: '365',
      muted: true,
    });

    expect(parsed).toEqual({ sessionId: SESSION_ID, subscription: '365', muted: true });
  });
});

describe('parseMuteState', () => {
  it('reads a set', () => {
    expect(parseMuteState({ muted: [`365:${SESSION_ID}`] })).toEqual({
      muted: [`365:${SESSION_ID}`],
    });
  });

  it('reads the empty set, which is what a deck with nothing muted gets', () => {
    expect(parseMuteState({ muted: [] })).toEqual({ muted: [] });
  });

  // Dropped rather than coerced (CODING-STANDARDS §11 rule 1). A `null` that became `"null"` would
  // be a mute in the page's set that nothing could ever clear.
  it('drops an entry that is not a string rather than making one up', () => {
    expect(parseMuteState({ muted: [`365:${SESSION_ID}`, null, 7, {}] })).toEqual({
      muted: [`365:${SESSION_ID}`],
    });
  });

  it.each([
    { value: {}, why: 'a missing field' },
    { value: { muted: `365:${SESSION_ID}` }, why: 'a set that is not a list' },
    { value: null, why: 'null' },
    { value: [], why: 'an array' },
  ])('refuses $why', ({ value }) => {
    expect(parseMuteState(value)).toBeUndefined();
  });
});

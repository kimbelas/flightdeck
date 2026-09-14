// P2-T2 — the wire shape of `POST /sessions`, on the side that has to doubt it.
//
// The id these guards admit becomes a pane target and a WebSocket attach argument, so the cases
// that matter are the ones that look like success: a 201 whose body is not a reply, and a refusal
// whose code core does not send.
import { describe, expect, it } from 'vitest';
import {
  LAUNCH_FAILURES,
  parseLaunchAccepted,
  parseLaunchFailure,
} from '../../contracts/launch-reply.ts';

const SESSION_ID = '337975f9-c9c0-454a-a22a-2d53a86e0ea9';

describe('parseLaunchAccepted', () => {
  it('takes the id core started', () => {
    expect(parseLaunchAccepted({ sessionId: SESSION_ID })).toEqual({ sessionId: SESSION_ID });
  });

  it('ignores anything else in the body rather than carrying it into the page', () => {
    expect(parseLaunchAccepted({ sessionId: SESSION_ID, prompt: 'do the thing' })).toEqual({
      sessionId: SESSION_ID,
    });
  });

  it('refuses an empty id, which would be a pane key that matches nothing', () => {
    expect(parseLaunchAccepted({ sessionId: '' })).toBeUndefined();
  });

  it('refuses a body that is not an object', () => {
    expect(parseLaunchAccepted(SESSION_ID)).toBeUndefined();
    expect(parseLaunchAccepted(null)).toBeUndefined();
    expect(parseLaunchAccepted([{ sessionId: SESSION_ID }])).toBeUndefined();
    expect(parseLaunchAccepted(undefined)).toBeUndefined();
  });

  it('refuses an id that is not a string', () => {
    expect(parseLaunchAccepted({ sessionId: 7 })).toBeUndefined();
  });
});

describe('parseLaunchFailure', () => {
  it('reads each code core actually sends', () => {
    for (const failure of LAUNCH_FAILURES) {
      expect(parseLaunchFailure({ error: failure })).toBe(failure);
    }
  });

  it('drops a code it does not know rather than showing it to the owner', () => {
    // The deck decides the wording, so an unrecognised code falls back to the status. Rendering
    // the string core sent would be the first step towards rendering a sentence it sent.
    expect(parseLaunchFailure({ error: 'kaboom' })).toBeUndefined();
    expect(parseLaunchFailure({ error: 'bad request' })).toBeUndefined();
  });

  it('drops a body carrying no code at all', () => {
    expect(parseLaunchFailure({})).toBeUndefined();
    expect(parseLaunchFailure('unavailable')).toBeUndefined();
    expect(parseLaunchFailure(undefined)).toBeUndefined();
    expect(parseLaunchFailure(null)).toBeUndefined();
    expect(parseLaunchFailure(['no_claude'])).toBeUndefined();
  });
});

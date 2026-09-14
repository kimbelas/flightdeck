// Which session an expanded row is asking about — P2-T4, SEC-ING-1.
//
// Three strings that arrive from a browser and end up composing a filesystem path. The shape check
// IS the path check: `shortId` names a directory, and the only safe thing to do with a value that
// will name one is to prove it is eight hex characters before anything interpolates it.
import { describe, expect, it } from 'vitest';
import { parseSessionRef, sessionRefQuery } from '../../contracts/session-ref.ts';

const WHOLE = {
  session: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
  short: 'cb5e8102',
  subscription: 'isg',
};

describe('parseSessionRef', () => {
  it('accepts a whole reference', () => {
    expect(parseSessionRef(WHOLE)).toEqual({
      sessionId: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
      shortId: 'cb5e8102',
      subscription: 'isg',
    });
  });

  it('refuses a missing half', () => {
    // All three are required. A reference missing its subscription names a session id that is only
    // unique within a config dir, which is two different sessions on this machine.
    expect(parseSessionRef({ ...WHOLE, subscription: '' })).toBeUndefined();
    expect(parseSessionRef({ ...WHOLE, short: '' })).toBeUndefined();
    expect(parseSessionRef({ ...WHOLE, session: '' })).toBeUndefined();
    expect(parseSessionRef({})).toBeUndefined();
  });

  it('refuses a subscription that is not one of the two', () => {
    expect(parseSessionRef({ ...WHOLE, subscription: 'personal' })).toBeUndefined();
  });

  it('refuses anything that is not a lowercase uuid', () => {
    expect(
      parseSessionRef({ ...WHOLE, session: 'CB5E8102-F057-4D5C-AD98-EAC21A12F37D' }),
    ).toBeUndefined();
    expect(parseSessionRef({ ...WHOLE, session: 'cb5e8102' })).toBeUndefined();
  });

  it('refuses a short id that could name anything but a job directory', () => {
    // The assertion that matters. `shortId` is interpolated into
    // `<configDir>\jobs\<shortId>\state.json`, so traversal, separators and wildcards must not
    // survive the parse — and they do not, because the check is a SHAPE and not an escape.
    for (const short of [
      '..',
      '..\\..\\daemon',
      '../../daemon',
      'cb5e8102\\..\\..',
      'cb5e810*',
      'cb5e8102 ',
      'cb5e81020',
      'cb5e810',
      'g15e8102',
      'CB5E8102',
    ]) {
      expect(parseSessionRef({ ...WHOLE, short })).toBeUndefined();
    }
  });
});

describe('sessionRefQuery', () => {
  it('round-trips through the parser, which is what keeps the two ends spelling it the same', () => {
    const ref = {
      sessionId: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
      shortId: 'cb5e8102',
      subscription: '365',
    } as const;

    const parsed = parseSessionRef(Object.fromEntries(new URLSearchParams(sessionRefQuery(ref))));

    expect(parsed).toEqual(ref);
  });
});

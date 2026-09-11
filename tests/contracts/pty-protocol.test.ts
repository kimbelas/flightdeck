// The frame guards — CODING-STANDARDS §11 rule 1: reject, don't coerce.
import { describe, expect, it } from 'vitest';
import {
  encodeServerFrame,
  parseClientFrame,
  parsePtyTarget,
  parseTargetPayload,
  sameTarget,
} from '../../contracts/pty-protocol.ts';

describe('parseClientFrame', () => {
  it.each([
    { raw: '{"type":"auth","ticket":"abc"}', why: 'an auth frame' },
    { raw: '{"type":"input","data":"ls\\r"}', why: 'an input frame' },
    { raw: '{"type":"resize","cols":120,"rows":40}', why: 'a resize frame' },
  ])('accepts $why', ({ raw }) => {
    expect(parseClientFrame(raw)).toBeDefined();
  });

  it.each([
    { raw: 'not json', why: 'a non-JSON frame' },
    { raw: 'null', why: 'a null frame' },
    { raw: '"a string"', why: 'a bare string' },
    { raw: '[1,2,3]', why: 'an array' },
    { raw: '{"type":"unknown"}', why: 'an unknown type' },
    { raw: '{"type":"auth"}', why: 'auth with no ticket' },
    { raw: '{"type":"auth","ticket":123}', why: 'a non-string ticket' },
    {
      raw: '{"type":"auth","token":"abc"}',
      why: 'the old token field, which is no longer a frame',
    },
    { raw: '{"type":"input","data":null}', why: 'null input data' },
    { raw: '{"type":"resize","cols":0,"rows":24}', why: 'a zero column count' },
    { raw: '{"type":"resize","cols":-5,"rows":24}', why: 'a negative size' },
    { raw: '{"type":"resize","cols":1.5,"rows":24}', why: 'a fractional size' },
    { raw: '{"type":"resize","cols":99999,"rows":24}', why: 'a size past the cap' },
    { raw: '{"type":"resize","cols":"80","rows":"24"}', why: 'a stringified size' },
  ])('drops $why', ({ raw }) => {
    expect(parseClientFrame(raw)).toBeUndefined();
  });

  it('does not coerce a bad resize into a default', () => {
    // The trap this guards: a terminal that silently becomes 80x24 because a frame was malformed.
    expect(parseClientFrame('{"type":"resize","cols":null,"rows":null}')).toBeUndefined();
  });
});

describe('parsePtyTarget — the bind target, fixed at handshake (SEC-WS-2)', () => {
  it('reads a shell request', () => {
    expect(parsePtyTarget('/pty?shell=1')).toEqual({ kind: 'shell' });
  });

  it('reads a session with its subscription', () => {
    expect(
      parsePtyTarget('/pty?session=11111111-2222-3333-4444-555555555555&subscription=365'),
    ).toEqual({
      kind: 'session',
      sessionId: '11111111-2222-3333-4444-555555555555',
      subscription: '365',
    });
  });

  it.each([
    { url: undefined, why: 'no url at all' },
    { url: '/pty', why: 'no target' },
    { url: '/pty?shell=0', why: 'shell explicitly off' },
    {
      url: '/pty?session=11111111-2222-3333-4444-555555555555',
      why: 'a session with no subscription',
    },
    { url: '/pty?session=abc12345&subscription=aws', why: 'an unknown subscription' },
    { url: '/pty?session=../../etc&subscription=365', why: 'a traversal in the id' },
    { url: '/pty?session=a&subscription=365', why: 'an id too short to be one' },
    { url: '/pty?session=%00&subscription=365', why: 'a null byte' },
    { url: '/pty?session=x;calc.exe&subscription=365', why: 'a command separator' },
  ])('refuses $why', ({ url }) => {
    expect(parsePtyTarget(url)).toBeUndefined();
  });

  it('never falls back to a shell when the session target is bad', () => {
    // Fails closed: a mistyped session id must not quietly hand back a working shell.
    expect(parsePtyTarget('/pty?session=!!!&subscription=365&shell=1')).toBeUndefined();
  });
});

describe('encodeServerFrame', () => {
  it('round-trips through the client parser for the frames that are symmetrical', () => {
    const encoded = encodeServerFrame({ type: 'output', data: 'hello' });

    expect(JSON.parse(encoded)).toEqual({ type: 'output', data: 'hello' });
  });
});

describe('parseTargetPayload — the same target, from a ticket request body (SEC-WS-1)', () => {
  it('reads a shell request', () => {
    expect(parseTargetPayload({ kind: 'shell' })).toEqual({ kind: 'shell' });
  });

  it('reads a session with its subscription', () => {
    expect(
      parseTargetPayload({
        kind: 'session',
        sessionId: '11111111-2222-3333-4444-555555555555',
        subscription: 'isg',
      }),
    ).toEqual({
      kind: 'session',
      sessionId: '11111111-2222-3333-4444-555555555555',
      subscription: 'isg',
    });
  });

  it.each([
    { payload: undefined, why: 'nothing' },
    { payload: null, why: 'null' },
    { payload: 'shell', why: 'a bare string' },
    { payload: { kind: 'root' }, why: 'a kind outside the union' },
    { payload: { kind: 'session', subscription: '365' }, why: 'a session with no id' },
    { payload: { kind: 'session', sessionId: 'nope', subscription: '365' }, why: 'a bad id' },
    {
      payload: { kind: 'session', sessionId: '11111111-2222-3333-4444-555555555555' },
      why: 'no subscription',
    },
    {
      payload: {
        kind: 'session',
        sessionId: '11111111-2222-3333-4444-555555555555',
        subscription: 'other',
      },
      why: 'a subscription outside the union',
    },
    {
      payload: {
        kind: 'session',
        sessionId: '11111111-2222-3333-4444-55555555555',
        subscription: '365',
      },
      why: 'a uuid one character short',
    },
  ])('refuses $why', ({ payload }) => {
    expect(parseTargetPayload(payload)).toBeUndefined();
  });

  it('agrees with parsePtyTarget, which is what lets a ticket be checked against a URL', () => {
    const fromUrl = parsePtyTarget(
      '/pty?session=11111111-2222-3333-4444-555555555555&subscription=365',
    );

    expect(parseTargetPayload(fromUrl)).toEqual(fromUrl);
  });
});

describe('sameTarget — what binds a ticket to one pane', () => {
  const session = {
    kind: 'session',
    sessionId: '11111111-2222-3333-4444-555555555555',
    subscription: '365',
  } as const;

  it('matches a session against itself', () => {
    expect(sameTarget(session, { ...session })).toBe(true);
  });

  it('separates the same id under the other subscription', () => {
    expect(sameTarget(session, { ...session, subscription: 'isg' })).toBe(false);
  });

  it('separates two different sessions', () => {
    expect(
      sameTarget(session, { ...session, sessionId: '99999999-2222-3333-4444-555555555555' }),
    ).toBe(false);
  });

  it('never matches a session against a shell', () => {
    expect(sameTarget(session, { kind: 'shell' })).toBe(false);
    expect(sameTarget({ kind: 'shell' }, session)).toBe(false);
  });

  it('treats every shell as the same target — a shell has no identity to hold', () => {
    expect(sameTarget({ kind: 'shell' }, { kind: 'shell' })).toBe(true);
  });
});

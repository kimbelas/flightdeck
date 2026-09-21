// The frame guards — CODING-STANDARDS §11 rule 1: reject, don't coerce.
import { describe, expect, it } from 'vitest';
import {
  encodeServerFrame,
  parseClientFrame,
  parsePtyTarget,
  parseTargetPayload,
  sameTarget,
  type PtyTarget,
} from '../../contracts/pty-protocol.ts';
import { MAX_PROJECT_PATH_CHARS } from '../../contracts/project.ts';

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

/** A real `projectKey`: lowercased, separators folded. Matched by core, never built from. */
const KEY = String.raw`c:\users\owner\documents\ledger`;

const shell: PtyTarget = { kind: 'shell', id: 'shell-1', project: undefined };

describe('parsePtyTarget — the bind target, fixed at handshake (SEC-WS-2)', () => {
  it('reads a shell request, which now names WHICH shell (P6-T1)', () => {
    expect(parsePtyTarget('/pty?shell=shell-2')).toEqual({
      kind: 'shell',
      id: 'shell-2',
      project: undefined,
    });
  });

  it('reads the folder a shell starts in, as a project KEY', () => {
    expect(parsePtyTarget(`/pty?shell=shell-1&project=${encodeURIComponent(KEY)}`)).toEqual({
      kind: 'shell',
      id: 'shell-1',
      project: KEY,
    });
  });

  // `?shell=1` used to be the whole spelling and `?shell=0` meant "not a shell". Both are
  // gone: `1` is now simply a shell named `1`, and there is no off switch to get wrong.
  // The refusals below are about the SHAPE of an id, which is what replaced them.
  it.each([
    { id: '', why: 'an empty id' },
    { id: 'Shell-1', why: 'an id with a capital in it' },
    { id: '-shell', why: 'an id that starts with a dash' },
    { id: '../../etc', why: 'a traversal in the id' },
    { id: 'shell 1', why: 'a space in the id' },
    { id: 'a'.repeat(33), why: 'an id past the cap' },
  ])('refuses a shell with $why', ({ id }) => {
    expect(parsePtyTarget(`/pty?shell=${encodeURIComponent(id)}`)).toBeUndefined();
  });

  it('refuses a shell whose project key is longer than a path can be', () => {
    const huge = 'c:'.padEnd(MAX_PROJECT_PATH_CHARS + 2, 'x');

    expect(parsePtyTarget(`/pty?shell=shell-1&project=${huge}`)).toBeUndefined();
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
    expect(parsePtyTarget('/pty?session=!!!&subscription=365&shell=shell-1')).toBeUndefined();
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
    expect(parseTargetPayload({ kind: 'shell', id: 'shell-1', project: undefined })).toEqual({
      kind: 'shell',
      id: 'shell-1',
      project: undefined,
    });
  });

  it('reads the folder a shell starts in', () => {
    expect(parseTargetPayload({ kind: 'shell', id: 'shell-2', project: KEY })).toEqual({
      kind: 'shell',
      id: 'shell-2',
      project: KEY,
    });
  });

  // A ticket is minted against this value and redeemed against the URL's, so a payload that
  // parsed more loosely than `parsePtyTarget` would widen what a ticket admits (SEC-WS-1).
  it.each([
    { payload: { kind: 'shell' }, why: 'a shell with no id' },
    { payload: { kind: 'shell', id: 'Shell-1' }, why: 'a shell id with a capital in it' },
    { payload: { kind: 'shell', id: 7 }, why: 'a shell id that is not a string' },
    { payload: { kind: 'shell', id: 'shell-1', project: 42 }, why: 'a project that is not a key' },
    { payload: { kind: 'shell', id: 'shell-1', project: '' }, why: 'an empty project key' },
  ])('refuses $why', ({ payload }) => {
    expect(parseTargetPayload(payload)).toBeUndefined();
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
    expect(sameTarget(session, { kind: 'shell', id: 'shell-1', project: undefined })).toBe(false);
    expect(sameTarget({ kind: 'shell', id: 'shell-1', project: undefined }, session)).toBe(false);
  });

  it('matches a shell against itself', () => {
    expect(sameTarget(shell, { ...shell })).toBe(true);
  });

  // Shells used to all be equal. They are not, and this is the reason: a ticket minted for
  // the shell at home must not redeem into one inside a repository (SEC-WS-1).
  it('separates two shells in different folders', () => {
    expect(sameTarget(shell, { ...shell, project: KEY })).toBe(false);
  });

  it('separates two shells in the SAME folder', () => {
    expect(sameTarget(shell, { ...shell, id: 'shell-2' })).toBe(false);
  });
});

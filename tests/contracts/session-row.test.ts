// P1-T9. The row's identity, its order, and the parser that admits one off the wire.
//
// The parser matters more than it looks: it is the gate between `DraftEvent.payload`, which is
// `unknown` on purpose, and a frame a browser will render (SEC-UI-2).
import { describe, expect, it } from 'vitest';
import {
  byAttentionThenAge,
  parseSessionRow,
  sessionKey,
  type SessionRow,
} from '../../contracts/session-row.ts';

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
  status: 'busy',
  attachable: true,
  notAttachableBecause: undefined,
};

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return { ...ROW, ...overrides };
}

describe('sessionKey', () => {
  it('includes the subscription, because an id is only unique within a config dir', () => {
    expect(sessionKey(row())).toBe(`365:${ROW.sessionId}`);
    expect(sessionKey(row({ subscription: 'isg' }))).not.toBe(sessionKey(row()));
  });
});

describe('byAttentionThenAge', () => {
  it('puts a blocked session first, whatever its age', () => {
    const blocked = row({ sessionId: 'b', runState: 'blocked', startedAt: 0 });
    const working = row({ sessionId: 'w', runState: 'working', startedAt: 9000 });

    expect([working, blocked].sort(byAttentionThenAge)[0]).toBe(blocked);
  });

  it('puts a live session above one that has ended', () => {
    const ended = row({ sessionId: 'e', live: false, startedAt: 9000 });
    const live = row({ sessionId: 'l', live: true, startedAt: 0 });

    expect([ended, live].sort(byAttentionThenAge)[0]).toBe(live);
  });

  it('orders the rest newest first', () => {
    const older = row({ sessionId: 'o', startedAt: 1000 });
    const newer = row({ sessionId: 'n', startedAt: 2000 });

    expect([older, newer].sort(byAttentionThenAge)[0]).toBe(newer);
  });
});

describe('parseSessionRow', () => {
  it('round-trips a row through JSON', () => {
    expect(parseSessionRow(JSON.parse(JSON.stringify(ROW)))).toEqual(ROW);
  });

  it('puts back the optional fields JSON.stringify dropped', () => {
    // The reason this is a parser and not a type guard: `name: undefined` does not survive
    // serialisation, so what arrives is missing a property the type requires.
    const wire: unknown = JSON.parse(JSON.stringify(row({ name: undefined })));

    const parsed = parseSessionRow(wire);

    expect(parsed).toBeDefined();
    expect(parsed?.name).toBeUndefined();
    expect(parsed !== undefined && 'name' in parsed).toBe(true);
  });

  it('drops a value outside a closed union rather than rendering it', () => {
    const parsed = parseSessionRow({ ...ROW, runState: 'exploding', status: 'vibing' });

    expect(parsed?.runState).toBeUndefined();
    expect(parsed?.status).toBeUndefined();
  });

  it('refuses a row with no identity', () => {
    expect(parseSessionRow({ ...ROW, sessionId: 42 })).toBeUndefined();
    expect(parseSessionRow({ ...ROW, subscription: 'other' })).toBeUndefined();
    expect(parseSessionRow({ ...ROW, kind: 'daemon' })).toBeUndefined();
    expect(parseSessionRow({ ...ROW, startedAt: 'soon' })).toBeUndefined();
  });

  it('refuses anything that is not an object', () => {
    expect(parseSessionRow(undefined)).toBeUndefined();
    expect(parseSessionRow(null)).toBeUndefined();
    expect(parseSessionRow('a row, honestly')).toBeUndefined();
    expect(parseSessionRow([ROW])).toBeUndefined();
  });

  it('treats a missing boolean as false rather than as truthy', () => {
    const parsed = parseSessionRow({ ...ROW, live: 'yes', attachable: 1 });

    expect(parsed?.live).toBe(false);
    expect(parsed?.attachable).toBe(false);
  });
});

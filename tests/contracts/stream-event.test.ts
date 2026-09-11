// P1-T9. What the deck is willing to believe arrived on the stream.
//
// Every case here is "and what if it is not what we expected": the frames come from core over
// loopback, but the parser is the boundary (CODING-STANDARDS §11 rule 1) and the wire is the one
// place a row and a piece of model text look the same until something checks.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import { parseStreamFrame, STREAM_FRAME_NAMES } from '../../contracts/stream-event.ts';

const ROW: SessionRow = {
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shortId: 'aaaaaaaa',
  subscription: '365',
  kind: 'background',
  name: 'fd-one',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: true,
  runState: 'blocked',
  status: undefined,
  attachable: true,
  notAttachableBecause: undefined,
};

const OLDER: SessionRow = {
  ...ROW,
  sessionId: 'bbbbbbbb-0000-0000-0000-000000000000',
  shortId: 'bbbbbbbb',
  runState: 'working',
  startedAt: 500,
};

function frame(name: string, data: unknown): ReturnType<typeof parseStreamFrame> {
  return parseStreamFrame(name, JSON.stringify(data));
}

describe('parseStreamFrame — snapshot', () => {
  it('reads the rows, the unreadable subscriptions and the timestamp', () => {
    const parsed = frame('snapshot', { rows: [ROW], unreadable: ['isg'], takenAt: 7 });

    expect(parsed).toEqual({
      name: 'snapshot',
      data: { rows: [ROW], unreadable: ['isg'], takenAt: 7 },
    });
  });

  it('sorts the rows the way the sender did, so nothing moves on arrival', () => {
    const parsed = frame('snapshot', { rows: [OLDER, ROW], unreadable: [], takenAt: 7 });

    expect(parsed?.name === 'snapshot' && parsed.data.rows[0]?.runState).toBe('blocked');
  });

  it('drops a row it cannot read without losing the rest of the snapshot', () => {
    const parsed = frame('snapshot', {
      rows: [ROW, { sessionId: 'nonsense' }],
      unreadable: ['isg'],
      takenAt: 7,
    });

    expect(parsed?.name === 'snapshot' && parsed.data.rows).toHaveLength(1);
    expect(parsed?.name === 'snapshot' && parsed.data.unreadable).toEqual(['isg']);
  });

  it('drops an unreadable entry that is not a subscription', () => {
    const parsed = frame('snapshot', { rows: [], unreadable: ['isg', 'evil'], takenAt: 7 });

    expect(parsed?.name === 'snapshot' && parsed.data.unreadable).toEqual(['isg']);
  });

  it('refuses a snapshot that is missing a field entirely', () => {
    expect(frame('snapshot', { rows: [], unreadable: [] })).toBeUndefined();
    expect(frame('snapshot', { rows: [], takenAt: 7 })).toBeUndefined();
    expect(frame('snapshot', { rows: 'none', unreadable: [], takenAt: 7 })).toBeUndefined();
  });
});

describe('parseStreamFrame — sessions', () => {
  it('reads an upsert', () => {
    expect(frame('session.upsert', ROW)).toEqual({ name: 'session.upsert', data: ROW });
  });

  it('reads a gone frame, which carries the identity and nothing else', () => {
    const parsed = frame('session.gone', { sessionId: ROW.sessionId, subscription: 'isg' });

    expect(parsed).toEqual({
      name: 'session.gone',
      data: { sessionId: ROW.sessionId, subscription: 'isg' },
    });
  });

  it('refuses a gone frame for a subscription that does not exist', () => {
    expect(frame('session.gone', { sessionId: 'a', subscription: 'other' })).toBeUndefined();
  });
});

describe('parseStreamFrame — everything else', () => {
  it('drops a frame name it does not know, rather than guessing', () => {
    // What lets core add a frame type without breaking a deck that has not been rebuilt.
    expect(frame('quota', { used: 1 })).toBeUndefined();
    expect(frame('', {})).toBeUndefined();
  });

  it('treats malformed JSON as an unrecognised frame rather than throwing', () => {
    expect(() => parseStreamFrame('snapshot', '{not json')).not.toThrow();
    expect(parseStreamFrame('snapshot', '{not json')).toBeUndefined();
    expect(parseStreamFrame('session.upsert', '')).toBeUndefined();
  });

  it('lists exactly the names the deck subscribes to', () => {
    expect([...STREAM_FRAME_NAMES]).toEqual(['snapshot', 'session.upsert', 'session.gone']);
  });
});

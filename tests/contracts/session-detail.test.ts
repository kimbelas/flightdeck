// `parseSessionDetail` — the boundary between core and an expanded row (P2-T4).
//
// The interesting half is that this re-parses what core just built. It looks redundant and is not:
// the caps in job-state.ts are the SEC-UI-2 boundary, and enforcing them only on the way OUT would
// leave the deck taking core's word for the size of a model-written string. The one required field
// is the session id, because it is the only thing that says which row a detail belongs to.
import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS } from '../../contracts/job-state.ts';
import {
  NO_EXTRAS,
  parseSessionDetail,
  type SessionDetail,
} from '../../contracts/session-detail.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const NOW = 1_789_000_100_000;

const WHOLE: SessionDetail = {
  sessionId: SESSION,
  at: NOW,
  job: {
    state: 'blocked',
    detail: 'looking for a git repository',
    needs: 'initialize a git repository',
    result: undefined,
    tempo: 'blocked',
    tokens: 454,
    inFlightTasks: 0,
    intent: 'show me the last five commits',
    updatedAt: NOW - 60_000,
  },
  timeline: [{ at: NOW - 60_000, state: 'working', detail: 'looking', text: 'Checking the repo.' }],
  vitals: {
    at: NOW - 2000,
    modelName: 'Opus 5',
    usedPercentage: 42,
    costUsd: 1.25,
    contextWindowSize: 200_000,
  },
  extras: {
    ...NO_EXTRAS,
    title: 'the-one',
    titleIsCustom: true,
    files: ['C:\\work\\a.ts'],
    costUsd: 1.25,
    linesAdded: 12,
    linesRemoved: 3,
  },
  tokenTrail: [
    { at: 1000, tokens: 100 },
    { at: 2000, tokens: 300 },
  ],
};

/** Through JSON, because that is the only way this value ever arrives. */
function overTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('parseSessionDetail', () => {
  it('round-trips a whole detail', () => {
    expect(parseSessionDetail(overTheWire(WHOLE))).toEqual(WHOLE);
  });

  it('refuses a body with no session id, which is the only field that identifies a row', () => {
    // An expansion rendered against the wrong row would be worse than one that did not open.
    expect(parseSessionDetail({ at: NOW })).toBeUndefined();
    expect(parseSessionDetail({ sessionId: '', at: NOW })).toBeUndefined();
    expect(parseSessionDetail('detail')).toBeUndefined();
    expect(parseSessionDetail([])).toBeUndefined();
  });

  it('accepts a detail where every producer said nothing', () => {
    // The ordinary case for an interactive session that has not rendered a status line.
    const parsed = parseSessionDetail({ sessionId: SESSION });

    expect(parsed?.job).toBeUndefined();
    expect(parsed?.timeline).toEqual([]);
    expect(parsed?.vitals).toBeUndefined();
    expect(parsed?.extras).toEqual(NO_EXTRAS);
    expect(parsed?.tokenTrail).toEqual([]);
  });

  it('applies the timeline caps again on the way IN, not just on the way out', () => {
    // The point of re-parsing. A core that shipped an uncapped `text` \u2014 an older build, or one that
    // regressed \u2014 must not be able to put an unbounded model-written string into the DOM.
    const parsed = parseSessionDetail({
      sessionId: SESSION,
      timeline: [
        { at: '2026-01-01T00:00:00Z', state: 'working', text: 'z'.repeat(MAX_TEXT_CHARS * 3) },
      ],
    });

    expect(parsed?.timeline[0]?.text).toHaveLength(MAX_TEXT_CHARS + 1);
  });

  it('drops a token point it cannot place rather than plotting a gap', () => {
    const parsed = parseSessionDetail({
      sessionId: SESSION,
      tokenTrail: [{ at: 1000, tokens: 100 }, { tokens: 300 }, { at: 3000 }, 42],
    });

    expect(parsed?.tokenTrail).toEqual([{ at: 1000, tokens: 100 }]);
  });

  it('drops a file entry that is not a string', () => {
    const parsed = parseSessionDetail({
      sessionId: SESSION,
      extras: { files: ['C:\\work\\a.ts', 42, '', null] },
    });

    expect(parsed?.extras.files).toEqual(['C:\\work\\a.ts']);
  });

  it('reads a malformed block as absent rather than refusing the whole detail', () => {
    const parsed = parseSessionDetail({
      sessionId: SESSION,
      job: 'blocked',
      timeline: 'none',
      vitals: 7,
      extras: [],
    });

    expect(parsed?.sessionId).toBe(SESSION);
    expect(parsed?.job).toBeUndefined();
    expect(parsed?.timeline).toEqual([]);
    expect(parsed?.extras).toEqual(NO_EXTRAS);
  });
});

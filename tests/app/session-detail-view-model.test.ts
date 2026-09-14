// The expanded row's presentation, decided without a DOM — P2-T4, CODING-STANDARDS §3.
//
// The one decision worth most of this file is the "doing now" precedence. Three sources can answer
// it and they do not mean the same thing, so the order is a product judgement rather than a
// fallback chain: a session ASKING for something outranks a session narrating, which outranks an
// inference from the transcript. A component choosing that with nested ternaries is a component
// nobody can test.
import { describe, expect, it } from 'vitest';
import { NO_EXTRAS, type SessionDetail } from '../../contracts/session-detail.ts';
import { SessionDetailViewModel } from '../../app/deck/session-detail-view-model.ts';

const NOW = 1_789_000_100_000;
const MINUTE = 60_000;

function detail(overrides: Partial<SessionDetail> = {}): SessionDetailViewModel {
  return new SessionDetailViewModel({
    sessionId: 'cb5e8102-f057-4d5c-ad98-eac21a12f37d',
    at: NOW,
    job: undefined,
    timeline: [],
    vitals: undefined,
    extras: NO_EXTRAS,
    tokenTrail: [],
    ...overrides,
  });
}

function job(overrides: Record<string, unknown> = {}): SessionDetail['job'] {
  return {
    state: 'blocked',
    detail: 'looking for a git repository',
    needs: undefined,
    result: undefined,
    tempo: 'blocked',
    tokens: 454,
    inFlightTasks: 0,
    intent: 'show me the last five commits',
    updatedAt: NOW - MINUTE,
    ...overrides,
  };
}

describe('doingNow — the precedence', () => {
  it('puts `needs` first, because "what does this want from me" is the deck`s question', () => {
    const view = detail({
      job: job({ needs: 'initialize a git repository' }),
      extras: { ...NO_EXTRAS, lastTool: 'Bash' },
    });

    expect(view.doingNow).toEqual({ text: 'initialize a git repository', source: 'needs' });
    expect(view.needsYou).toBe(true);
  });

  it('falls back to the daemon`s own summary when nothing is being asked for', () => {
    const view = detail({ job: job(), extras: { ...NO_EXTRAS, lastTool: 'Bash' } });

    expect(view.doingNow).toEqual({ text: 'looking for a git repository', source: 'detail' });
    expect(view.needsYou).toBe(false);
  });

  it('falls back to the last tool when there is no job file at all', () => {
    // SPEC §5.5's ◇ fallback, and the only answer available for an interactive session — which has
    // no job directory (F.7.1) and therefore never has the two better sources.
    const view = detail({ extras: { ...NO_EXTRAS, lastTool: 'Bash' } });

    expect(view.doingNow).toEqual({ text: 'running Bash', source: 'tool' });
  });

  it('says so plainly when no source has anything', () => {
    expect(detail().doingNow).toEqual({ text: 'nothing to report yet', source: 'none' });
  });
});

describe('intent', () => {
  it('prefers the job file`s first prompt, which is the owner`s own text', () => {
    const view = detail({
      job: job(),
      extras: { ...NO_EXTRAS, lastPrompt: 'something later' },
    });

    expect(view.intent).toBe('show me the last five commits');
  });

  it('falls back to the transcript`s last prompt for a session with no job file', () => {
    expect(detail({ extras: { ...NO_EXTRAS, lastPrompt: 'GO GO GO' } }).intent).toBe('GO GO GO');
  });
});

describe('recap', () => {
  const entries = Array.from({ length: 12 }, (unused, index) => ({
    at: NOW - (12 - index) * MINUTE,
    state: 'working' as const,
    detail: `step-${String(index)}`,
    text: undefined,
  }));

  it('reads newest first, unlike the file it came from', () => {
    // The file is oldest-first and that is right on disk; a recap is read like a notification list.
    const view = detail({ timeline: entries });

    expect(view.recap[0]?.detail).toBe('step-11');
  });

  it('shows a handful, not the whole history', () => {
    expect(detail({ timeline: entries }).recap).toHaveLength(8);
  });

  it('prefers Claude Code`s own away summary over the newest transition message', () => {
    const view = detail({
      timeline: [{ at: NOW, state: 'blocked', detail: 'stuck', text: 'The command failed.' }],
      extras: { ...NO_EXTRAS, awaySummary: 'Ran the tests and two failed.' },
    });

    expect(view.awaySummary).toBe('Ran the tests and two failed.');
  });

  it('falls back to the newest transition that carried a message', () => {
    const view = detail({
      timeline: [
        { at: NOW - MINUTE, state: 'blocked', detail: 'stuck', text: 'The command failed.' },
        { at: NOW, state: 'working', detail: 'retrying', text: undefined },
      ],
    });

    expect(view.awaySummary).toBe('The command failed.');
  });
});

describe('files', () => {
  const files = Array.from({ length: 14 }, (unused, index) => `C:\\work\\file-${String(index)}.ts`);

  it('shows a handful and counts the rest rather than lying about the total', () => {
    const view = detail({ extras: { ...NO_EXTRAS, files } });

    expect(view.files).toHaveLength(8);
    expect(view.moreFiles).toBe(6);
  });

  it('shows the trailing segment, because a full path is unreadable in a dense row', () => {
    expect(detail().fileName('C:\\work\\deep\\thing.ts')).toBe('thing.ts');
    expect(detail().fileName('/usr/local/thing.ts')).toBe('thing.ts');
    // A path that is only separators has nothing to trim to; it comes back whole rather than empty.
    expect(detail().fileName('\\\\')).toBe('\\\\');
  });
});

describe('the sparkline', () => {
  const trail = [
    { at: 1000, tokens: 100 },
    { at: 2000, tokens: 300 },
    { at: 3000, tokens: 800 },
  ];

  it('normalises to its own extremes and puts the newest on the right', () => {
    const points = detail({ tokenTrail: trail }).sparkline ?? '';

    // x climbs left to right; y is inverted because SVG y grows downward, so the largest count is
    // at y=0 and the smallest at y=100.
    expect(points).toBe('0.0,100.0 50.0,71.4 100.0,0.0');
  });

  it('draws nothing for fewer than two points, because a dot is not a line', () => {
    expect(detail({ tokenTrail: [{ at: 1000, tokens: 100 }] }).sparkline).toBeUndefined();
    expect(detail().sparkline).toBeUndefined();
    expect(detail().trailRange).toBeUndefined();
  });

  it('does not divide by zero when every reading is identical', () => {
    // Possible in principle, and an NaN in a `points` attribute silently draws nothing.
    const points = detail({
      tokenTrail: [
        { at: 1000, tokens: 100 },
        { at: 1000, tokens: 100 },
      ],
    }).sparkline;

    expect(points).not.toContain('NaN');
  });

  it('labels the endpoints, which is what stands in for the missing axis', () => {
    expect(detail({ tokenTrail: trail }).trailRange).toEqual({ from: '100', to: '800' });
  });

  it('reads a token count at a glance', () => {
    const view = detail();

    expect(view.tokensLabel(812)).toBe('812');
    expect(view.tokensLabel(604_365)).toBe('604K');
    expect(view.tokensLabel(29_615_351)).toBe('29.6M');
  });
});

describe('vitals and spend', () => {
  it('prefers the statusLine`s cost, which is Claude Code`s own figure (D5)', () => {
    const view = detail({
      vitals: {
        at: NOW,
        modelName: 'Opus 5',
        usedPercentage: 42,
        costUsd: 9.5,
        contextWindowSize: 200_000,
      },
      extras: { ...NO_EXTRAS, costUsd: 1.25 },
    });

    expect(view.costLabel).toBe('$9.50');
    expect(view.contextPercent).toBe(42);
  });

  it('falls back to the transcript`s cost when there is no reading', () => {
    expect(detail({ extras: { ...NO_EXTRAS, costUsd: 1.25 } }).costLabel).toBe('$1.25');
  });

  it('has no cost label at all rather than $0.00 when nothing reported one', () => {
    expect(detail().costLabel).toBeUndefined();
    expect(detail().contextPercent).toBeUndefined();
  });

  it('shows lines as a pair, treating one absent half as zero', () => {
    expect(detail({ extras: { ...NO_EXTRAS, linesAdded: 128, linesRemoved: 34 } }).linesLabel).toBe(
      '+128 −34',
    );
    expect(detail({ extras: { ...NO_EXTRAS, linesAdded: 5 } }).linesLabel).toBe('+5 −0');
    expect(detail().linesLabel).toBeUndefined();
  });
});

describe('isBare', () => {
  it('is true only when no producer said anything', () => {
    expect(detail().isBare).toBe(true);
  });

  it('is false as soon as any one of them did', () => {
    expect(detail({ job: job() }).isBare).toBe(false);
    expect(
      detail({ timeline: [{ at: NOW, state: 'working', detail: 'x', text: undefined }] }).isBare,
    ).toBe(false);
    expect(
      detail({
        vitals: {
          at: NOW,
          modelName: undefined,
          usedPercentage: undefined,
          costUsd: undefined,
          contextWindowSize: undefined,
        },
      }).isBare,
    ).toBe(false);
    expect(detail({ extras: { ...NO_EXTRAS, files: ['C:\\a.ts'] } }).isBare).toBe(false);
  });
});

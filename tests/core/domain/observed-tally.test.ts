// The fold over a folder's transcripts — P3-T5.
//
// Every number here was checked against the real thing once: reading this repository's own slug
// (68 transcripts, 90 MB) answered 3 945 `Bash`, 495 `Write`, 7 `scheduled_task_fire`, 0
// compactions and 0 unknown lines, and `$863.78` on 365 against `$0.60` on isg. What this file
// does is pin the RULES that produced those, with six records instead of ninety megabytes.
import { describe, expect, it } from 'vitest';
import type { TranscriptRecord } from '../../../contracts/transcript-record.ts';
import { ObservedTally, WEEK_MS } from '../../../core/domain/observed-tally.ts';

const NOW = 1_700_000_000_000;

function tool(
  name: string,
  extra: Partial<Extract<TranscriptRecord, { kind: 'tool' }>> = {},
): TranscriptRecord {
  return {
    kind: 'tool',
    tool: name,
    skill: undefined,
    contextTokens: undefined,
    at: NOW,
    ...extra,
  };
}

describe('ObservedTally', () => {
  it('answers a shape with every field at zero before anything is added', () => {
    const summary = new ObservedTally().summarise('C:/p', NOW, 5);

    expect(summary).toMatchObject({
      path: 'C:/p',
      at: NOW,
      tookMs: 5,
      sessions: 0,
      tools: [],
      skills: [],
      compactions: 0,
      medianPeakContextTokens: 0,
    });
  });

  it('counts tools across sessions, commonest first', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [tool('Bash'), tool('Bash'), tool('Edit')], 10);
    tally.addSession('isg', [tool('Bash'), tool('Write')], 20);

    expect(tally.summarise('C:/p', NOW, 0).tools).toEqual([
      { name: 'Bash', count: 3 },
      { name: 'Edit', count: 1 },
      { name: 'Write', count: 1 },
    ]);
  });

  /** Skills leave no record of their own — a `Skill` call's `input.skill` is the whole trace. */
  it('counts a skill as a skill AND as the tool call it was', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [tool('Skill', { skill: 'ship' }), tool('Skill', { skill: 'run' })], 0);

    const summary = tally.summarise('C:/p', NOW, 0);
    expect(summary.skills).toEqual([
      { name: 'run', count: 1 },
      { name: 'ship', count: 1 },
    ]);
    expect(summary.tools).toEqual([{ name: 'Skill', count: 2 }]);
  });

  it('counts the names sessions ran under, which is what `agent-name` actually holds', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [{ kind: 'agent', name: 'flightdeck' }], 0);
    tally.addSession('365', [{ kind: 'agent', name: 'flightdeck' }], 0);
    tally.addSession('isg', [{ kind: 'agent', name: 'deck-demo' }], 0);

    expect(tally.summarise('C:/p', NOW, 0).sessionNames).toEqual([
      { name: 'flightdeck', count: 2 },
      { name: 'deck-demo', count: 1 },
    ]);
  });

  it('takes a session’s cost as its LARGEST reading, never the sum of every turn’s', () => {
    // `cost-state` is rewritten per turn with the running total, so adding them up would report a
    // session as having cost several times what Claude Code says it did (D5 — never recompute).
    const tally = new ObservedTally();
    tally.addSession('365', [cost(1.5), cost(4.25), cost(9)], 0);

    expect(tally.summarise('C:/p', NOW, 0).shares).toEqual([
      { subscription: '365', sessions: 1, costUsd: 9 },
    ]);
  });

  it('splits sessions and cost by subscription, busiest first', () => {
    const tally = new ObservedTally();
    tally.addSession('isg', [cost(0.5)], 0);
    tally.addSession('365', [cost(10)], 0);
    tally.addSession('365', [cost(5)], 0);

    expect(tally.summarise('C:/p', NOW, 0).shares).toEqual([
      { subscription: '365', sessions: 2, costUsd: 15 },
      { subscription: 'isg', sessions: 1, costUsd: 0.5 },
    ]);
  });

  it('counts a session as this week by its NEWEST record, not by when it started', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [tool('Bash', { at: NOW - WEEK_MS - 1 })], 0);
    tally.addSession('365', [tool('Bash', { at: NOW - 1000 })], 0);
    // A session that reported no instant at all is not counted as recent — it is not counted.
    tally.addSession('365', [{ kind: 'title', title: 'x', custom: false }], 0);

    const summary = tally.summarise('C:/p', NOW, 0);
    expect(summary.sessions).toBe(3);
    expect(summary.sessionsThisWeek).toBe(1);
  });

  it('takes the PEAK context per session and the median across them', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [context(10_000), context(90_000), context(40_000)], 0);
    tally.addSession('365', [context(20_000)], 0);
    tally.addSession('365', [context(30_000)], 0);

    // Peaks are 90k, 20k, 30k — the median is 30k, and the mean would have been 46.6k.
    expect(tally.summarise('C:/p', NOW, 0).medianPeakContextTokens).toBe(30_000);
  });

  it('reads context off a turn that also called a tool, because one line is both', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [tool('Bash', { contextTokens: 77_000 })], 0);

    expect(tally.summarise('C:/p', NOW, 0).medianPeakContextTokens).toBe(77_000);
  });

  it('leaves a session that reported no usage out of the median rather than at zero', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [context(50_000)], 0);
    tally.addSession('365', [tool('Bash')], 0);

    expect(tally.summarise('C:/p', NOW, 0).medianPeakContextTokens).toBe(50_000);
  });

  it('counts compactions, scheduled fires and unknown lines', () => {
    const tally = new ObservedTally();
    tally.addSession(
      '365',
      [
        { kind: 'compaction', trigger: 'auto', preTokens: 1, postTokens: 0, at: NOW },
        { kind: 'scheduled', at: NOW, taskKind: 'loop', cron: '56 9 * * *' },
        { kind: 'scheduled', at: NOW, taskKind: 'loop', cron: '27 10 * * *' },
      ],
      0,
    );
    tally.addUnknownLine();

    expect(tally.summarise('C:/p', NOW, 0)).toMatchObject({
      compactions: 1,
      scheduledFires: 2,
      unknownLines: 1,
    });
  });

  // P7-T4. A `/loop` wake-up is a one-shot with a fresh task id each time, so the unit is the kind.
  it('groups scheduled fires by kind, counting each session once and keeping the newest cron', () => {
    const tally = new ObservedTally();
    const fire = (at: number, cron: string | undefined, taskKind: string | undefined) =>
      ({ kind: 'scheduled', at, taskKind, cron }) as const;
    tally.addSession(
      'isg',
      [fire(NOW - 60, '56 9 * * *', 'loop'), fire(NOW, '27 10 * * *', 'loop')],
      0,
    );
    tally.addSession(
      '365',
      [fire(NOW - 120, undefined, 'loop'), fire(NOW - 5, undefined, undefined)],
      0,
    );

    expect(tally.summarise('C:/p', NOW, 0).schedules).toEqual([
      { kind: 'loop', fires: 3, sessions: 2, lastAt: NOW, lastCron: '27 10 * * *' },
      { kind: 'scheduled', fires: 1, sessions: 1, lastAt: NOW - 5, lastCron: undefined },
    ]);
  });

  it('caps every list, because a long tail is not a dashboard', () => {
    const tally = new ObservedTally();
    tally.addSession(
      '365',
      Array.from({ length: 30 }, (unused, index) => tool(`tool-${String(index)}`)),
      0,
    );

    expect(tally.summarise('C:/p', NOW, 0).tools).toHaveLength(8);
  });

  it('adds up the bytes it was told it read, which is what makes the cost printable', () => {
    const tally = new ObservedTally();
    tally.addSession('365', [], 1000);
    tally.addSession('isg', [], 2000);

    expect(tally.summarise('C:/p', NOW, 0).bytesRead).toBe(3000);
  });
});

function cost(costUsd: number): TranscriptRecord {
  return { kind: 'cost', costUsd, linesAdded: 0, linesRemoved: 0, spend: [], at: NOW };
}

function context(contextTokens: number): TranscriptRecord {
  return { kind: 'context', contextTokens, at: NOW };
}

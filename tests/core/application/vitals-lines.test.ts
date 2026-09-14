// `vitalsLines` — the one projection of the registry, and what it refuses to carry (P2-T3).
//
// It has two readers now: `GET /status`, which the CLI prints, and the `quota` frame, which the
// deck's header draws. That is the whole reason it is a function rather than a private method, and
// the reason it is tested on its own: the fields it drops are a security boundary (SEC-DATA-2), and
// a boundary enforced in two copies is a boundary that lasts until somebody edits one of them.
import { describe, expect, it } from 'vitest';
import { vitalsLines } from '../../../core/application/vitals-lines.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import type { SessionVitalsLine } from '../../../contracts/core-status.ts';
import type { StatuslineReport } from '../../../contracts/statusline-report.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const AT = 1_789_000_100_000;

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: SESSION,
    transcriptPath: 'C:\\Users\\someone\\.claude-isg\\projects\\flightdeck\\t.jsonl',
    sessionName: 'the-one',
    modelId: 'claude-opus-5',
    modelName: 'Opus 5',
    claudeVersion: '2.1.7',
    costUsd: 1.25,
    usedPercentage: 42,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: AT + 7_200_000 },
    sevenDay: { usedPercentage: 61, resetsAt: AT + 400_000_000 },
    ...overrides,
  };
}

function linesFrom(...reports: readonly StatuslineReport[]): readonly SessionVitalsLine[] {
  const registry = new VitalsRegistry();
  reports.forEach((entry, index) => registry.record(entry, 'isg', AT + index));
  return vitalsLines(registry);
}

describe('vitalsLines', () => {
  it('flattens both quota windows into the four columns the table prints', () => {
    const [line] = linesFrom(report());

    expect(line?.fiveHourPercentage).toBe(23);
    expect(line?.fiveHourResetsAt).toBe(AT + 7_200_000);
    expect(line?.sevenDayPercentage).toBe(61);
    expect(line?.sevenDayResetsAt).toBe(AT + 400_000_000);
  });

  it('carries the Claude version, which is what the header`s chip reads', () => {
    expect(linesFrom(report())[0]?.claudeVersion).toBe('2.1.7');
  });

  it('never carries the transcript path', () => {
    // The field that names the Windows account and the project folder. It is in the registry, it is
    // in `StatuslineReport`, and it stops here — on both routes at once, because there is one
    // projection (SEC-DATA-2).
    expect(JSON.stringify(linesFrom(report()))).not.toContain('.claude-isg');
    expect(Object.keys(linesFrom(report())[0] ?? {})).not.toContain('transcriptPath');
  });

  it('does not carry the model id or the context window size either', () => {
    // Not security, just the same discipline: what is never sent cannot be depended on, and the
    // table prints the display name.
    const keys = Object.keys(linesFrom(report())[0] ?? {});

    expect(keys).not.toContain('modelId');
    expect(keys).not.toContain('contextWindowSize');
  });

  it('keeps `undefined` as `undefined` rather than settling for zero', () => {
    // A session before its first turn reports nulls (RESEARCH.md F.3.5). Coercing them here would
    // put a 0 %-used context bar and a 0 % quota gauge on every session that has not spoken yet.
    const [line] = linesFrom(
      report({
        usedPercentage: undefined,
        costUsd: undefined,
        fiveHour: { usedPercentage: undefined, resetsAt: undefined },
      }),
    );

    expect(line?.usedPercentage).toBeUndefined();
    expect(line?.costUsd).toBeUndefined();
    expect(line?.fiveHourPercentage).toBeUndefined();
    expect(line?.fiveHourResetsAt).toBeUndefined();
  });

  it('carries when each reading arrived, which is what makes a stale one visible', () => {
    const lines = linesFrom(
      report(),
      report({ sessionId: 'd1b2f43c-1111-4222-a333-444444444444' }),
    );

    expect(lines.map((line) => line.at)).toEqual([AT, AT + 1]);
  });
});

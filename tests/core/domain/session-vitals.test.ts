// SessionVitals — the null-versus-zero trap P0-T5 measured (RESEARCH.md F.3.5).
import { describe, expect, it } from 'vitest';
import { CONTEXT_PRESSURE_PERCENT, SessionVitals } from '../../../core/domain/session-vitals.ts';

describe('SessionVitals', () => {
  it('distinguishes "no data yet" from "0 % used"', () => {
    // Before the first turn the payload carries these as NULL, not absent and not zero. A model
    // that conflates them draws an empty context bar on a session that has not spoken.
    expect(SessionVitals.unknown().usedPercentage).toBeUndefined();
    expect(SessionVitals.of({ usedPercentage: 0, costUsd: 0 }).usedPercentage).toBe(0);
  });

  it.each([
    [undefined, false],
    [0, false],
    [CONTEXT_PRESSURE_PERCENT - 1, false],
    [CONTEXT_PRESSURE_PERCENT, true],
    [100, true],
  ])('at %s used, pressure is %s', (usedPercentage, expected) => {
    expect(SessionVitals.of({ usedPercentage, costUsd: undefined }).isUnderPressure).toBe(expected);
  });

  it.each([-1, 101, 130])('throws on an impossible percentage: %i', (usedPercentage) => {
    // A 130 %-full context window means the payload changed and the parser above stopped
    // understanding it — a bug, so it throws rather than returning a Result.
    expect(() => SessionVitals.of({ usedPercentage, costUsd: undefined })).toThrow(
      /not a valid usedPercentage/,
    );
  });

  it('throws on a negative cost', () => {
    expect(() => SessionVitals.of({ usedPercentage: undefined, costUsd: -0.01 })).toThrow(
      /not a valid costUsd/,
    );
  });

  it('accepts a cost with no percentage and vice versa — the feeds are independent', () => {
    expect(SessionVitals.of({ usedPercentage: undefined, costUsd: 2.5 }).costUsd).toBe(2.5);
    expect(SessionVitals.of({ usedPercentage: 10, costUsd: undefined }).costUsd).toBeUndefined();
  });

  it('compares by value', () => {
    const one = SessionVitals.of({ usedPercentage: 10, costUsd: 1 });
    expect(one.equals(SessionVitals.of({ usedPercentage: 10, costUsd: 1 }))).toBe(true);
    expect(one.equals(SessionVitals.of({ usedPercentage: 11, costUsd: 1 }))).toBe(false);
    expect(one.equals(SessionVitals.unknown())).toBe(false);
  });
});

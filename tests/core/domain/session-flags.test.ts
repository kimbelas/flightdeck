// The derived flags, table-tested — DECISIONS.md D7 as corrected by D29.
//
// Two of these tests exist specifically to stop D7's original wording being re-implemented from
// memory: nothing may key off `waitingFor` (it does not exist), and `retired` cannot come from the
// listing. Both are measured facts (RESEARCH.md F.2.1, F.2.3) and both are easy to "fix" back.
import { describe, expect, it } from 'vitest';
import type { SessionFlag } from '../../../contracts/session.ts';
import {
  WEDGED_AFTER_MS,
  deriveFlags,
  type FlagInput,
} from '../../../core/domain/session-flags.ts';
import { SessionState, type Observation } from '../../../core/domain/session-state.ts';
import { SessionVitals } from '../../../core/domain/session-vitals.ts';
import { unwrap } from '../../../core/shared/result.ts';

function observation(runState: Observation['runState'], live: boolean): Observation {
  return { runState, status: undefined, live };
}

function input(overrides: Partial<FlagInput> = {}): FlagInput {
  return {
    state: SessionState.initial(observation('working', true)),
    vitals: SessionVitals.unknown(),
    sinceLastEventMs: 0,
    attentionSignal: false,
    ...overrides,
  };
}

describe('deriveFlags — needs-you', () => {
  it('is set by state === blocked, which is the whole of the listing signal', () => {
    const state = SessionState.initial(observation('blocked', true));
    expect(deriveFlags(input({ state }))).toContain('needs-you');
  });

  it('is set by the hooks feed signal on a session the listing calls working', () => {
    // idle_prompt / permission_prompt / idle-after-Stop all arrive this way (P1-T5).
    expect(deriveFlags(input({ attentionSignal: true }))).toContain('needs-you');
  });

  it('is not set on an ordinary working session', () => {
    expect(deriveFlags(input())).not.toContain('needs-you');
  });
});

describe('deriveFlags — wedged', () => {
  it('needs working, live, and silence past the threshold', () => {
    expect(deriveFlags(input({ sinceLastEventMs: WEDGED_AFTER_MS }))).toContain('wedged');
  });

  it('is not set a millisecond early', () => {
    expect(deriveFlags(input({ sinceLastEventMs: WEDGED_AFTER_MS - 1 }))).not.toContain('wedged');
  });

  it('is never set on a session with no pid, however long ago it last spoke', () => {
    // Without the liveness check every finished row in the listing turns amber ten minutes later.
    const state = SessionState.initial(observation('working', false));
    expect(deriveFlags(input({ state, sinceLastEventMs: WEDGED_AFTER_MS * 10 }))).not.toContain(
      'wedged',
    );
  });

  it('is not set on a session that has never produced an event', () => {
    expect(deriveFlags(input({ sinceLastEventMs: undefined }))).not.toContain('wedged');
  });

  it('is not set on a blocked session — it is waiting for a person, not stuck', () => {
    const state = SessionState.initial(observation('blocked', true));
    expect(deriveFlags(input({ state, sinceLastEventMs: WEDGED_AFTER_MS * 5 }))).not.toContain(
      'wedged',
    );
  });
});

describe('deriveFlags — context-pressure', () => {
  it.each([
    [79, false],
    [80, true],
    [100, true],
  ])('at %i%% used it is %s', (usedPercentage, expected) => {
    const vitals = SessionVitals.of({ usedPercentage, costUsd: undefined });
    expect(deriveFlags(input({ vitals })).includes('context-pressure')).toBe(expected);
  });

  it('is not set before the first turn, when the number is null rather than zero (F.3.5)', () => {
    expect(deriveFlags(input({ vitals: SessionVitals.unknown() }))).not.toContain(
      'context-pressure',
    );
  });
});

describe('deriveFlags — retired', () => {
  it('comes from the end reason, never from the listing (F.2.3)', () => {
    const done = SessionState.initial(observation('done', false));
    const retired = unwrap(done.endedBecause('retired'));
    expect(deriveFlags(input({ state: retired }))).toContain('retired');
  });

  it('is absent while the reason is unknown, which is most of P1', () => {
    const done = SessionState.initial(observation('done', false));
    expect(deriveFlags(input({ state: done }))).not.toContain('retired');
  });

  it('never also reads as errored — retirement is a normal resting state (D7)', () => {
    const done = SessionState.initial(observation('done', false));
    const retired = unwrap(done.endedBecause('retired'));
    expect(deriveFlags(input({ state: retired }))).not.toContain('errored');
  });
});

describe('deriveFlags — errored and live', () => {
  it('is set by a failed run state', () => {
    const state = SessionState.initial(observation('failed', false));
    expect(deriveFlags(input({ state }))).toContain('errored');
  });

  it('is set by a failed end reason on a done session', () => {
    const done = SessionState.initial(observation('done', false));
    expect(deriveFlags(input({ state: unwrap(done.endedBecause('failed')) }))).toContain('errored');
  });

  it('tracks liveness by pid presence', () => {
    expect(deriveFlags(input())).toContain('live');
    const dead = SessionState.initial(observation('done', false));
    expect(deriveFlags(input({ state: dead }))).not.toContain('live');
  });
});

describe('deriveFlags — ordering', () => {
  it('puts needs-you first, because P2-T4 badges a row with the first flag', () => {
    const blocked = SessionState.initial(observation('blocked', true));
    const vitals = SessionVitals.of({ usedPercentage: 95, costUsd: 1 });
    const flags: readonly SessionFlag[] = deriveFlags(input({ state: blocked, vitals }));
    expect(flags[0]).toBe('needs-you');
    expect(flags).toContain('context-pressure');
  });
});

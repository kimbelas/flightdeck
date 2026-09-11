// The state machine, table-tested — CODING-STANDARDS §10.1.
//
// What the table is really pinning is that Flightdeck OBSERVES rather than owns this state. The
// only refusal is a session running again after it finished, because the CLI's resume semantics
// make that impossible under the same id (RESEARCH.md F.2.7) — so seeing it means the shape
// changed, not that the session did.
import { describe, expect, it } from 'vitest';
import type { ActivityStatus, EndReason, RunState } from '../../../contracts/session.ts';
import { SessionState, type Observation } from '../../../core/domain/session-state.ts';
import { unwrap } from '../../../core/shared/result.ts';

function seen(runState: RunState | undefined, live: boolean, status?: ActivityStatus): Observation {
  return { runState, status, live };
}

const LIVE_WORKING = seen('working', true, 'busy');
const BLOCKED = seen('blocked', true, 'idle');
const DONE = seen('done', false);

describe('SessionState — observing the listing', () => {
  const table: readonly {
    from: Observation;
    to: Observation;
    legal: boolean;
    why: string;
  }[] = [
    { from: LIVE_WORKING, to: BLOCKED, legal: true, why: 'working to blocked is the normal path' },
    { from: LIVE_WORKING, to: DONE, legal: true, why: 'anything may finish' },
    { from: BLOCKED, to: LIVE_WORKING, legal: true, why: 'answered, and carries on' },
    { from: BLOCKED, to: DONE, legal: true, why: 'a blocked session can be stopped' },
    { from: DONE, to: seen('failed', false), legal: true, why: 'terminal to terminal is fine' },
    { from: DONE, to: LIVE_WORKING, legal: false, why: 'a finished session cannot run again' },
    { from: DONE, to: BLOCKED, legal: false, why: 'nor come back blocked' },
    {
      from: LIVE_WORKING,
      to: seen(undefined, true),
      legal: true,
      why: 'an interactive record carries no state at all',
    },
  ];

  it.each(table)('$why', ({ from, to, legal }) => {
    const outcome = SessionState.initial(from).observe(to);
    expect(outcome.ok).toBe(legal);
    if (outcome.ok) expect(outcome.value.runState).toBe(to.runState);
    else expect(outcome.error.code).toBe('illegal_transition');
  });

  it('takes liveness from the observation, never from the run state', () => {
    // A record with no pid is not running whatever its state says (F.2.1).
    const state = SessionState.initial(seen('working', false));
    expect(state.runState).toBe('working');
    expect(state.isLive).toBe(false);
  });

  it('keeps a known end reason across a later terminal observation', () => {
    const stopped = unwrap(SessionState.initial(DONE).endedBecause('stopped'));
    const again = unwrap(stopped.observe(DONE));
    expect(again.endReason).toBe('stopped');
  });
});

describe('SessionState — why it ended', () => {
  it('is unknown by default, because the listing cannot tell you (F.2.3)', () => {
    expect(SessionState.initial(DONE).endReason).toBe('unknown');
  });

  it.each<EndReason>(['stopped', 'finished', 'retired', 'failed'])('accepts %s once', (reason) => {
    expect(unwrap(SessionState.initial(DONE).endedBecause(reason)).endReason).toBe(reason);
  });

  it('refuses a reason while the session is still running', () => {
    const outcome = SessionState.initial(LIVE_WORKING).endedBecause('stopped');
    expect(outcome.ok).toBe(false);
  });

  it('refuses to overwrite a known reason with a different one', () => {
    // Two sources disagreeing is worth surfacing; last-writer-wins would hide it.
    const stopped = unwrap(SessionState.initial(DONE).endedBecause('stopped'));
    expect(stopped.endedBecause('retired').ok).toBe(false);
    expect(stopped.endedBecause('stopped').ok).toBe(true);
  });
});

describe('SessionState — resume', () => {
  it('brings a terminal session back as live and working, reason cleared', () => {
    const retired = unwrap(SessionState.initial(DONE).endedBecause('retired'));
    const resumed = unwrap(retired.resume());
    expect(resumed.runState).toBe('working');
    expect(resumed.isLive).toBe(true);
    expect(resumed.endReason).toBe('unknown');
  });

  it('refuses to resume something that never stopped', () => {
    expect(SessionState.initial(LIVE_WORKING).resume().ok).toBe(false);
  });
});

describe('SessionState — equality', () => {
  it('compares by value across all four fields', () => {
    expect(SessionState.initial(BLOCKED).equals(SessionState.initial(BLOCKED))).toBe(true);
    expect(SessionState.initial(BLOCKED).equals(SessionState.initial(LIVE_WORKING))).toBe(false);
    const ended = unwrap(SessionState.initial(DONE).endedBecause('retired'));
    expect(ended.equals(SessionState.initial(DONE))).toBe(false);
  });
});

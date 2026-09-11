// The unions and their iteration tuples have to stay in step.
//
// A union can gain a member without anyone touching the tuple beside it, and nothing would fail:
// the type still compiles, and every `for (const x of TUPLE)` quietly skips the new case. These
// tests are the thing that notices. `satisfies` does the type half; the counts do the rest.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_STATUSES,
  END_REASONS,
  RUN_STATES,
  SESSION_FLAGS,
  SESSION_KINDS,
  SUBSCRIPTION_IDS,
  type ActivityStatus,
  type EndReason,
  type RunState,
  type SessionFlag,
  type SessionKind,
  type SubscriptionId,
} from '../../contracts/session.ts';

describe('the session vocabulary', () => {
  it.each([
    ['subscriptions', SUBSCRIPTION_IDS, 2],
    ['kinds', SESSION_KINDS, 2],
    ['run states', RUN_STATES, 4],
    ['activity statuses', ACTIVITY_STATUSES, 3],
    ['end reasons', END_REASONS, 5],
    ['flags', SESSION_FLAGS, 6],
  ])('%s has %i members, all distinct', (label, tuple, size) => {
    expect(tuple).toHaveLength(size);
    expect(new Set(tuple).size).toBe(size);
  });

  it('drops the vocabulary P0-T4 measured does not exist (D29)', () => {
    // `stopped` is documented and was never observed: `claude stop` leaves `state: done`
    // (RESEARCH.md F.2.3). It is an EndReason here, not a RunState.
    expect(RUN_STATES).not.toContain('stopped');
    expect(END_REASONS).toContain('stopped');
  });

  it('keeps retired as a reason rather than a state, so it can never read as a failure', () => {
    expect(RUN_STATES).not.toContain('retired');
    expect(END_REASONS).toContain('retired');
    expect(SESSION_FLAGS).toContain('retired');
  });

  it('types each tuple as its own union, so a typo cannot slip in', () => {
    expect(SUBSCRIPTION_IDS satisfies readonly SubscriptionId[]).toBeDefined();
    expect(SESSION_KINDS satisfies readonly SessionKind[]).toBeDefined();
    expect(RUN_STATES satisfies readonly RunState[]).toBeDefined();
    expect(ACTIVITY_STATUSES satisfies readonly ActivityStatus[]).toBeDefined();
    expect(END_REASONS satisfies readonly EndReason[]).toBeDefined();
    expect(SESSION_FLAGS satisfies readonly SessionFlag[]).toBeDefined();
  });
});

// The Session entity — transitions and the immutability the reconciler depends on.
import { describe, expect, it } from 'vitest';
import { Session, type SessionFacts } from '../../../core/domain/session.ts';
import { SessionId } from '../../../core/domain/session-id.ts';
import { WEDGED_AFTER_MS } from '../../../core/domain/session-flags.ts';
import type { Observation } from '../../../core/domain/session-state.ts';
import { SessionVitals } from '../../../core/domain/session-vitals.ts';
import { unwrap } from '../../../core/shared/result.ts';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const UUID = '020e5c73-aea4-45b5-9561-0ade34ac96fe';

const FACTS: SessionFacts = {
  id: SessionId.parse(UUID),
  subscription: 'isg',
  kind: 'background',
  name: 'fd-probe',
  cwd: 'C:\\work\\project',
  startedAt: new Date('2026-09-11T11:00:00.000Z'),
};

function observation(runState: Observation['runState'], live: boolean): Observation {
  return { runState, status: undefined, live };
}

function working(): Session {
  return Session.start(FACTS, observation('working', true));
}

describe('Session', () => {
  it('exposes the facts it was given', () => {
    const session = working();
    expect(session.id.short).toBe('020e5c73');
    expect(session.subscription).toBe('isg');
    expect(session.kind).toBe('background');
    expect(session.name).toBe('fd-probe');
    expect(session.cwd).toBe('C:\\work\\project');
    expect(session.startedAt).toEqual(new Date('2026-09-11T11:00:00.000Z'));
  });

  it('treats an unnamed session as ordinary, not an error', () => {
    const anonymous = Session.start({ ...FACTS, name: undefined }, observation('working', true));
    expect(anonymous.name).toBeUndefined();
  });

  it('starts with no vitals — nothing is known before the first statusLine payload', () => {
    expect(working().vitals.usedPercentage).toBeUndefined();
  });

  it('never mutates: every transition returns a new instance and leaves the old one alone', () => {
    const before = working();
    const after = unwrap(before.observe(observation('blocked', true)));
    expect(after).not.toBe(before);
    expect(before.state.runState).toBe('working');
    expect(after.state.runState).toBe('blocked');
  });

  it('propagates the state machine refusal rather than swallowing it', () => {
    const done = unwrap(working().observe(observation('done', false)));
    const outcome = done.observe(observation('working', true));
    expect(outcome.ok).toBe(false);
  });

  it('keeps unrelated fields across a transition', () => {
    const vitals = SessionVitals.of({ usedPercentage: 42, costUsd: 1.5 });
    const session = unwrap(working().withVitals(vitals).observe(observation('blocked', true)));
    expect(session.vitals.usedPercentage).toBe(42);
    expect(session.name).toBe('fd-probe');
  });
});

describe('Session — attention', () => {
  it('needs you when blocked', () => {
    const blocked = unwrap(working().observe(observation('blocked', true)));
    expect(blocked.needsYouAt(NOW)).toBe(true);
  });

  it('stops needing you once it ends, even if it was blocked when it did', () => {
    // Otherwise a finished row sits at the top of the deck forever.
    const blocked = working().withAttentionSignal(true);
    const done = unwrap(blocked.observe(observation('done', false)));
    expect(unwrap(done.endedBecause('stopped')).needsYouAt(NOW)).toBe(false);
  });

  it('refuses an end reason while it is still running, and stays unchanged', () => {
    const session = working();
    const outcome = session.endedBecause('stopped');
    expect(outcome.ok).toBe(false);
    expect(session.state.endReason).toBe('unknown');
  });

  it('refuses to resume something that never stopped', () => {
    expect(working().resume().ok).toBe(false);
  });

  it('clears the attention signal on resume too', () => {
    const done = unwrap(working().withAttentionSignal(true).observe(observation('done', false)));
    expect(unwrap(done.resume()).needsYouAt(NOW)).toBe(false);
  });
});

describe('Session — wedged is measured against the last event, not the start time', () => {
  it('is not wedged when it has just spoken', () => {
    const session = working().sawEventAt(new Date(NOW.getTime() - 1_000));
    expect(session.flagsAt(NOW)).not.toContain('wedged');
  });

  it('is wedged once the silence passes the threshold', () => {
    const session = working().sawEventAt(new Date(NOW.getTime() - WEDGED_AFTER_MS));
    expect(session.flagsAt(NOW)).toContain('wedged');
  });

  it('takes now as a parameter, so nothing in the domain reads a clock', () => {
    const session = working().sawEventAt(new Date(NOW.getTime() - WEDGED_AFTER_MS));
    const earlier = new Date(NOW.getTime() - WEDGED_AFTER_MS);
    expect(session.flagsAt(earlier)).not.toContain('wedged');
  });
});

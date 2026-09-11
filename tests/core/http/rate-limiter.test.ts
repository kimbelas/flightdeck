// SEC-HTTP-6 — P1-T10's last open control, landed with P1-T5.
//
// A fake clock, because the window is a minute and a test that waited one is a test nobody runs.
import { describe, expect, it } from 'vitest';
import { BUDGETS } from '../../../core/http/limits.ts';
import { RateLimiter } from '../../../core/http/rate-limiter.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';

const MINUTE = 60_000;

function spend(limiter: RateLimiter, key: string, times: number, perMinute: number): number {
  let allowed = 0;
  for (let index = 0; index < times; index += 1) {
    if (limiter.allow(key, perMinute)) allowed += 1;
  }
  return allowed;
}

describe('RateLimiter', () => {
  it('allows exactly the budget and refuses the next one', () => {
    const limiter = new RateLimiter(new FakeClock());

    expect(spend(limiter, 'token', 60, 60)).toBe(60);
    expect(limiter.allow('token', 60)).toBe(false);
  });

  it('starts a new window once the minute is up', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock);
    spend(limiter, 'token', 60, 60);

    clock.advance(MINUTE);

    expect(limiter.allow('token', 60)).toBe(true);
  });

  it('does not start one a moment early', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock);
    spend(limiter, 'token', 60, 60);

    clock.advance(MINUTE - 1);

    expect(limiter.allow('token', 60)).toBe(false);
  });

  it('counts each key separately, so one session cannot spend the budget of another', () => {
    const limiter = new RateLimiter(new FakeClock());
    spend(limiter, 'hook:aaaa', 600, 600);

    expect(limiter.allow('hook:bbbb', 600)).toBe(true);
    expect(limiter.allow('hook:aaaa', 600)).toBe(false);
  });

  it('keeps the deck and a session out of the same budget entirely', () => {
    // The prefixes are the point: control is per token, ingest is per session id, and 60 and 600
    // are different numbers for different callers (SEC-HTTP-6).
    const limiter = new RateLimiter(new FakeClock());
    spend(limiter, 'control:token', BUDGETS.control.perMinute, BUDGETS.control.perMinute);

    expect(limiter.allow('control:token', BUDGETS.control.perMinute)).toBe(false);
    expect(limiter.allow('hook:aaaa', BUDGETS.ingest.perMinute)).toBe(true);
  });

  it('forgets keys that have expired rather than growing forever', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock);
    for (let index = 0; index < 300; index += 1) limiter.allow(`hook:${String(index)}`, 600);
    expect(limiter.tracked).toBeGreaterThan(256);

    clock.advance(MINUTE);
    limiter.allow('hook:fresh', 600);

    // A key per session that never expires is a leak; sessions end all day on this machine.
    expect(limiter.tracked).toBe(1);
  });
});

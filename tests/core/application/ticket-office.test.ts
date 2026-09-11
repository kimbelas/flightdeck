// TicketOffice — the credential the PTY socket takes, and the four ways it stops being valid.
//
// Every test here is a property P5a-T2b was built to get: one use, one target, a few seconds, and
// nothing in the page worth stealing (DECISIONS.md D32).
import { describe, expect, it } from 'vitest';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { TicketOffice } from '../../../core/application/ticket-office.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';

const TTL_MS = 10_000;
type SessionTarget = Extract<PtyTarget, { kind: 'session' }>;

const SHELL: PtyTarget = { kind: 'shell' };
const SESSION: SessionTarget = {
  kind: 'session',
  sessionId: '11111111-2222-3333-4444-555555555555',
  subscription: '365',
};
const OTHER_SESSION: PtyTarget = {
  kind: 'session',
  sessionId: '99999999-8888-7777-6666-555555555555',
  subscription: '365',
};

function office(): { tickets: TicketOffice; clock: FakeClock } {
  const clock = new FakeClock();
  return { tickets: new TicketOffice(clock, TTL_MS), clock };
}

describe('minting', () => {
  it('issues a 256-bit hex ticket', () => {
    const { tickets } = office();

    expect(tickets.mint(SHELL)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never issues the same ticket twice', () => {
    const { tickets } = office();

    const issued = new Set(Array.from({ length: 50 }, () => tickets.mint(SHELL)));

    expect(issued.size).toBe(50);
  });
});

describe('redeeming', () => {
  it('accepts a fresh ticket for the target it was minted for', () => {
    const { tickets } = office();

    expect(tickets.redeem(tickets.mint(SESSION), SESSION)).toBe(true);
  });

  it('refuses a ticket that was already spent — single use, not merely short-lived', () => {
    const { tickets } = office();
    const ticket = tickets.mint(SHELL);
    tickets.redeem(ticket, SHELL);

    expect(tickets.redeem(ticket, SHELL)).toBe(false);
  });

  it('refuses a ticket minted for another session — one ticket is worth one pane', () => {
    const { tickets } = office();

    expect(tickets.redeem(tickets.mint(SESSION), OTHER_SESSION)).toBe(false);
  });

  it('refuses a session ticket presented for a shell', () => {
    const { tickets } = office();

    expect(tickets.redeem(tickets.mint(SESSION), SHELL)).toBe(false);
  });

  it('refuses a session ticket presented under the other subscription', () => {
    const { tickets } = office();

    expect(tickets.redeem(tickets.mint(SESSION), { ...SESSION, subscription: 'isg' })).toBe(false);
  });

  it('burns a ticket offered for the wrong target, rather than leaving it for a second guess', () => {
    const { tickets } = office();
    const ticket = tickets.mint(SESSION);
    tickets.redeem(ticket, OTHER_SESSION);

    expect(tickets.redeem(ticket, SESSION)).toBe(false);
  });

  it('refuses a ticket past its expiry', () => {
    const { tickets, clock } = office();
    const ticket = tickets.mint(SHELL);
    clock.advance(TTL_MS + 1);

    expect(tickets.redeem(ticket, SHELL)).toBe(false);
  });

  it('still accepts a ticket on the last millisecond of its window', () => {
    const { tickets, clock } = office();
    const ticket = tickets.mint(SHELL);
    clock.advance(TTL_MS);

    expect(tickets.redeem(ticket, SHELL)).toBe(true);
  });

  it('refuses a ticket it never issued', () => {
    const { tickets } = office();

    expect(tickets.redeem('f'.repeat(64), SHELL)).toBe(false);
  });

  it('refuses an empty first frame', () => {
    const { tickets } = office();

    expect(tickets.redeem('', SHELL)).toBe(false);
  });
});

describe('what the office holds', () => {
  it('sweeps expired tickets on the next mint rather than keeping them forever', () => {
    const { tickets, clock } = office();
    tickets.mint(SHELL);
    tickets.mint(SHELL);
    clock.advance(TTL_MS + 1);

    tickets.mint(SHELL);

    expect(tickets.outstandingCount).toBe(1);
  });

  it('caps what an unspent mint loop can accumulate', () => {
    const { tickets } = office();

    for (let index = 0; index < 500; index += 1) tickets.mint(SHELL);

    expect(tickets.outstandingCount).toBeLessThanOrEqual(64);
  });

  it('keeps the newest tickets when it evicts, so the pane that just asked still works', () => {
    const { tickets } = office();
    for (let index = 0; index < 500; index += 1) tickets.mint(SHELL);

    const newest = tickets.mint(SESSION);

    expect(tickets.redeem(newest, SESSION)).toBe(true);
  });

  it('drops everything on revokeAll — no ticket outlives the token that authorised it', () => {
    const { tickets } = office();
    const ticket = tickets.mint(SHELL);

    tickets.revokeAll();

    expect(tickets.redeem(ticket, SHELL)).toBe(false);
    expect(tickets.outstandingCount).toBe(0);
  });
});

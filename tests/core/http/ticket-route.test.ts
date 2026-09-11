// `POST /pty-ticket` — the mint the deck reaches through the rewrite (SEC-WS-1, D32).
//
// The headers are not tested here: CoreServer screens every request before a route sees it, and
// tests/core/http/core-server.test.ts and loopback-guard.test.ts own those refusals. What is this
// route's own is the body guard and the shape of what comes back.
import { describe, expect, it } from 'vitest';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { TicketOffice } from '../../../core/application/ticket-office.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { TicketRoute } from '../../../core/http/ticket-route.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';

const FACTS: RequestFacts = { method: 'POST', url: '/pty-ticket', headers: {} };
const SESSION: PtyTarget = {
  kind: 'session',
  sessionId: '11111111-2222-3333-4444-555555555555',
  subscription: '365',
};

function route(): { ticketRoute: TicketRoute; tickets: TicketOffice } {
  const tickets = new TicketOffice(new FakeClock());
  return { ticketRoute: new TicketRoute(tickets), tickets };
}

function post(ticketRoute: TicketRoute, body: unknown): { status: number; body: unknown } {
  return ticketRoute.handle(FACTS, JSON.stringify(body));
}

describe('TicketRoute', () => {
  it('answers a ticket the office will redeem for that session', () => {
    const { ticketRoute, tickets } = route();

    const response = post(ticketRoute, { target: SESSION });

    expect(response.status).toBe(201);
    const { ticket } = response.body as { ticket: string };
    expect(tickets.redeem(ticket, SESSION)).toBe(true);
  });

  it('mints for a shell', () => {
    const { ticketRoute, tickets } = route();

    const { ticket } = post(ticketRoute, { target: { kind: 'shell' } }).body as { ticket: string };

    expect(tickets.redeem(ticket, { kind: 'shell' })).toBe(true);
  });

  it('issues a different ticket every time', () => {
    const { ticketRoute } = route();

    const first = post(ticketRoute, { target: SESSION }).body as { ticket: string };
    const second = post(ticketRoute, { target: SESSION }).body as { ticket: string };

    expect(first.ticket).not.toBe(second.ticket);
  });

  it.each([
    { body: {}, why: 'no target' },
    { body: { target: null }, why: 'a null target' },
    { body: { target: { kind: 'root' } }, why: 'a target kind that does not exist' },
    {
      body: { target: { kind: 'session', sessionId: 'not-a-uuid', subscription: '365' } },
      why: 'a session id that is not a uuid',
    },
    {
      body: { target: { kind: 'session', sessionId: '11111111-2222-3333-4444-555555555555' } },
      why: 'no subscription',
    },
    {
      body: {
        target: {
          kind: 'session',
          sessionId: '11111111-2222-3333-4444-555555555555',
          subscription: 'other',
        },
      },
      why: 'a subscription outside the union',
    },
  ])('refuses $why without minting', ({ body }) => {
    const { ticketRoute, tickets } = route();

    expect(post(ticketRoute, body).status).toBe(400);
    expect(tickets.outstandingCount).toBe(0);
  });

  it('refuses a body that is not JSON', () => {
    const { ticketRoute } = route();

    expect(ticketRoute.handle(FACTS, 'not json at all').status).toBe(400);
  });

  it('refuses an empty body', () => {
    const { ticketRoute } = route();

    expect(ticketRoute.handle(FACTS, '').status).toBe(400);
  });
});

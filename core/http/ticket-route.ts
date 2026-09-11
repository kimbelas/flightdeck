// `POST /pty-ticket` — the only way to get a credential the PTY socket accepts (SEC-WS-1).
//
// It is a POST rather than a GET because every control that protects it is a POST control: the
// Content-Type check forces a preflight for any cross-origin page and core answers no preflight at
// all (SEC-HTTP-4, RESEARCH.md F.4.3), the Origin must be the deck, and the bearer token is
// attached server-side by `proxy.ts` on the way through the rewrite. A hostile page can reach this
// path — loopback is not a boundary — and fails all three.
//
// What the deck gets back is a ticket for the one target it named, good for seconds and for one
// socket (DECISIONS.md D32). The per-boot token stays on the server side of the rewrite.
import { parseTargetPayload } from '../../contracts/pty-protocol.ts';
import type { TicketOffice } from '../application/ticket-office.ts';
import type { RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class TicketRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/pty-ticket';
  private readonly tickets: TicketOffice;

  constructor(tickets: TicketOffice) {
    this.tickets = tickets;
  }

  /**
   * Mints a ticket for the target in the body.
   *
   * The target is not checked for existence here and must not be: whether a session is attachable
   * is PaneRegistry's answer at bind time (SEC-WS-3), and answering it here would turn this route
   * into an oracle for which sessions exist. The request facts go unread for the same reason they
   * do in LaunchRoute — CoreServer has already screened them.
   */
  public handle(facts: RequestFacts, body: string): JsonResponse {
    const target = parseTargetPayload(parse(body)?.['target']);
    if (target === undefined) return json(400, { error: 'bad request' });
    return json(201, { ticket: this.tickets.mint(target) });
  }
}

function parse(body: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

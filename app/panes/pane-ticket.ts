// Asks core for one ticket, for one pane — the browser half of DECISIONS.md D32.
//
// It goes through `/api/core/*`, which is the same-origin Next rewrite every other core call
// already uses: `proxy.ts` attaches the per-boot bearer token server-side, so the page authorises
// a mint it cannot itself perform, and the token stays where it was before P5a-T3 handed it over.
//
// What comes back is worth one PTY on one target for a few seconds. It is deliberately not stored
// anywhere — not in the store, not in a ref, not in state. A pane mints one when it connects and
// spends it immediately; a ticket that is worth keeping is a ticket that lives too long.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';

const TICKET_ROUTE = '/api/core/pty-ticket';

/**
 * Mints a ticket for `target`, or `undefined` if core would not.
 *
 * Absence is an ordinary state, not an exception: core being down, or refusing, is something the
 * pane renders (RESEARCH.md F.3.3). The caller fails closed on it and never retries silently —
 * a retry loop on a refused mint is a retry loop against the control that refused it.
 */
export async function requestPaneTicket(target: PtyTarget): Promise<string | undefined> {
  try {
    const response = await fetch(TICKET_ROUTE, {
      method: 'POST',
      // Not decoration: the JSON content-type is what forces a preflight for any page that is not
      // this one, and core answers no preflight at all (SEC-HTTP-4).
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const ticket = (body as Record<string, unknown>)['ticket'];
    return typeof ticket === 'string' ? ticket : undefined;
  } catch {
    return undefined;
  }
}

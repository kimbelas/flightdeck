// SEC-HTTP-4's body caps and SEC-HTTP-6's rate budgets, as one table (P1-T5).
//
// One table because they answer the same question, and answering it twice is how they drift: is
// this route talked to by a person through the deck, or by Claude Code on every turn of a session?
//
// | | body | per minute | why |
// |---|---|---|---|
// | `control` | 64 KB | 60 | a launch is a few hundred bytes and a human clicks a few times |
// | `ingest` | 4 MB | 600 | a hook's `tool_input` can be large; one arrives per turn per session |
// | `paste` | 8 MB | 30 | one screenshot, base64, pasted by a hand that has to press Ctrl+V |
//
// Every number comes straight from SECURITY.md. The 4 MB is not generosity: core ran with a single
// 256 KB cap until this task, which would have refused a large `PostToolUse` payload — and a
// refused hook is not a dropped event, it is `Stop hook error occurred` in front of the owner for
// every turn afterwards (RESEARCH.md F.1.5).
//
// Kept apart from `LoopbackGuard`, which screens headers and knows nothing about which route it is
// screening for; the cap depends on the route, so the server applies it once the route is found.

/**
 * Which budget a route spends.
 *
 * Declared by each route rather than defaulted, so a new one has to answer the question rather
 * than inherit whichever answer happened to be written first.
 */
export type RouteLimit = 'control' | 'ingest' | 'paste';

export interface Budget {
  /** SEC-HTTP-4. Bodies over this are refused `413` — the request is not merely truncated. */
  readonly bodyBytes: number;
  /** SEC-HTTP-6. Requests over this in a rolling minute are refused `429`. */
  readonly perMinute: number;
}

export const BUDGETS: Readonly<Record<RouteLimit, Budget>> = {
  control: { bodyBytes: 64 * 1024, perMinute: 60 },
  ingest: { bodyBytes: 4 * 1024 * 1024, perMinute: 600 },
  // P5a-T8. Neither of the two above fits a pasted image: `control` refuses a screenshot outright,
  // and `ingest`'s 600 a minute is a budget for a machine rather than for Ctrl+V. The body cap is
  // MAX_PASTED_IMAGE_BYTES plus base64's third plus the JSON around it; the domain re-checks the
  // DECODED size, so this number bounds the transfer and that one bounds the file.
  paste: { bodyBytes: 8 * 1024 * 1024, perMinute: 30 },
};

export function budgetFor(limit: RouteLimit): Budget {
  return BUDGETS[limit];
}

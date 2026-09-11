// SEC-HTTP-4's body caps and SEC-HTTP-6's rate budgets, as one table (P1-T5).
//
// One table because they answer the same question, and answering it twice is how they drift: is
// this route talked to by a person through the deck, or by Claude Code on every turn of a session?
//
// | | body | per minute | why |
// |---|---|---|---|
// | `control` | 64 KB | 60 | a launch is a few hundred bytes and a human clicks a few times |
// | `ingest` | 4 MB | 600 | a hook's `tool_input` can be large; one arrives per turn per session |
//
// Both numbers come straight from SECURITY.md. The 4 MB is not generosity: core ran with a single
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
export type RouteLimit = 'control' | 'ingest';

export interface Budget {
  /** SEC-HTTP-4. Bodies over this are refused `413` — the request is not merely truncated. */
  readonly bodyBytes: number;
  /** SEC-HTTP-6. Requests over this in a rolling minute are refused `429`. */
  readonly perMinute: number;
}

export const BUDGETS: Readonly<Record<RouteLimit, Budget>> = {
  control: { bodyBytes: 64 * 1024, perMinute: 60 },
  ingest: { bodyBytes: 4 * 1024 * 1024, perMinute: 600 },
};

export function budgetFor(limit: RouteLimit): Budget {
  return BUDGETS[limit];
}

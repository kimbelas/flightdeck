// What the listing says about ONE session right now — P6-T8, D63.
//
// A port of its own rather than a `Session` with a pid on it, because the pid is the one fact
// about a session that must never be remembered. A take-over ends the process the listing names,
// and a pid read a sweep ago — up to ten seconds — is a pid Windows may already have handed to
// something else. So the only caller asks at the moment of the press and acts on the answer
// immediately, and nothing else in core carries a pid at all.
import type { AgentRecord } from '../../contracts/agents-listing.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Result } from '../shared/result.ts';

export interface LiveSessionLookup {
  /**
   * The record `claude agents --json` carries for this session, read fresh.
   *
   * @returns `ok(undefined)` when the listing does not carry it — an interactive session that has
   * ended is forgotten at once (RESEARCH.md G.55) — and `err('unreadable')` when the listing could
   * not be read at all, which is a different answer and must not be mistaken for "it ended".
   * @throws never.
   */
  find(
    subscription: SubscriptionId,
    sessionId: string,
  ): Promise<Result<AgentRecord | undefined, 'unreadable'>>;
}

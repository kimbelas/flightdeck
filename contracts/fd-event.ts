// The append-only event record — BUILD-PLAN.md §3, the `events` table once the store lands.
//
// Two types for one record, because the id is not the producer's to invent. A reconciler sweep and
// a hook receiver both describe something that happened; only the store can say where it falls in
// the sequence, and `since=` paging (`GET /sessions/:id/events`) is meaningless unless that
// sequence has exactly one author. A `DraftEvent` is what you publish, an `FdEvent` is what came
// back with its place in line.
//
// **`type` stays a `string`, against R12's preference for discriminated unions, and deliberately.**
// The set is open: hook event names are Claude Code's to choose and it adds them between releases
// (SPEC §3 lists nine today). A union here would turn an unrecognised event into a type error in
// the one component whose whole job is to record it anyway — the same reason `Sweep.skipped`
// counts unnameable records rather than throwing on them (RESEARCH.md F.2.1). Producers name their
// own types; a consumer narrows on `source` first, which IS closed.
import type { SubscriptionId } from './session.ts';

/** Which producer observed it. Closed: a new source is a new adapter, not a Claude Code release. */
export type EventSource =
  'hook' | 'statusline' | 'reconcile' | 'transcript' | 'fswatch' | 'launcher';

export const EVENT_SOURCES: readonly EventSource[] = [
  'hook',
  'statusline',
  'reconcile',
  'transcript',
  'fswatch',
  'launcher',
];

/** An event as its producer describes it, before the store gives it a place in the sequence. */
export interface DraftEvent {
  /** Epoch ms, taken from a `Clock`. Nothing in core reads `Date.now()` (CODING-STANDARDS §10.1). */
  readonly at: number;
  /** `SessionId.full`. The short id is the uuid's first segment and is for humans (F.2.1). */
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
  readonly source: EventSource;
  readonly type: string;
  /**
   * The producer's raw payload, kept verbatim for replay and for capturing fixtures.
   *
   * `unknown`, not `any`: it is narrowed by a schema at the boundary that produced it (§11.1) and
   * never read here. It is also the field most likely to carry model text, so anything that
   * renders it treats it as untrusted (SEC-UI-2).
   */
  readonly payload: unknown;
}

/** A stored event. `id` is monotonic within one store and is what `since=` pages against. */
export interface FdEvent extends DraftEvent {
  readonly id: number;
}

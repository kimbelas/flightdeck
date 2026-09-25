// What `GET /telemetry` answers — P7-T5. The per-session sums the OTLP receiver has heard.
//
// **In memory, since core started**, like the statusLine's vitals (core/main.ts): Claude Code
// exports DELTAS, so a restarted core starts every sum from nothing and says so with `since`.
// Durable history — cost per project, subscription and week — is `cost-state`'s job and P7-T3's
// (DECISIONS.md D5); this feed is the second opinion, and a second opinion that outlived the first
// would need a reconciliation nobody has asked for.

import type { TelemetryEventName } from './otlp-logs.ts';

/** The `type` values each split metric is kept under — Claude Code's documented set. */
export const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheCreation'] as const;
export const ACTIVE_KINDS = ['user', 'cli'] as const;
export const LINE_KINDS = ['added', 'removed'] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];
export type ActiveKind = (typeof ACTIVE_KINDS)[number];
export type LineKind = (typeof LINE_KINDS)[number];

export interface SessionTelemetry {
  readonly sessionId: string;
  /** USD, summed over every model. `claude_code.cost.usage` — Claude Code's own figure. */
  readonly costUsd: number;
  readonly tokens: Readonly<Record<TokenKind, number>>;
  /** Seconds. `user` is the owner at the keyboard; `cli` is Claude working. */
  readonly activeSeconds: Readonly<Record<ActiveKind, number>>;
  readonly lines: Readonly<Record<LineKind, number>>;
  readonly commits: number;
  readonly pullRequests: number;
  /** How many of each event arrived. An event that never did is absent, not `0`. */
  readonly events: Readonly<Partial<Record<TelemetryEventName, number>>>;
  /** When core last heard about this session over OTLP, epoch ms. */
  readonly lastAt: number;
}

export interface TelemetryReport {
  /** Whether core was started with the receiver on. `false` means `sessions` is always empty. */
  readonly enabled: boolean;
  /** When the sums began — core's start, epoch ms. */
  readonly since: number;
  /** Most recently heard first. */
  readonly sessions: readonly SessionTelemetry[];
  /** Points and records received and not used — see `MetricsBatch.skipped`. */
  readonly skipped: number;
}

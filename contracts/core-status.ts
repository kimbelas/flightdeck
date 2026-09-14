// What `GET /status` answers, and what `flightdeck-core status` prints — P1-T12.
//
// **Why not `/health`.** That route answers liveness and deliberately nothing else: it is the one
// an operator script hits most often, so it is the one with the least to leak (health-route.ts).
// This is the opposite trade — everything core knows about itself, once, for a person reading it.
//
// **Why not `/sessions`.** There is no session table here. `/sessions` already answers that, and a
// second route with a second opinion about what is running is precisely what `contracts/
// session-row.ts` exists to prevent. `flightdeck-core status` asks both and joins them by session
// id, which is also why `SessionVitalsLine` carries the id and nothing else identifying.
//
// **What is deliberately absent: `transcriptPath`.** It is in `StatuslineReport` and it is not
// here. A transcript path carries the account name and the project folder, which is identity this
// screen does not need to print (SEC-DATA-2) — the same reason `TranscriptReader` logs a session
// id instead.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** Facts about the process. From `process`, at the HTTP edge — not from the application layer. */
export interface RuntimeFacts {
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly nodeVersion: string;
}

export interface StoreStatus {
  readonly path: string;
  /** `PRAGMA user_version` — the number of migrations applied (core/adapters/sqlite/schema.ts). */
  readonly schemaVersion: number;
  readonly stored: number;
  readonly snapshots: number;
  /** Events lost to a failing store. Non-zero is a problem, which is why it is printed. */
  readonly dropped: number;
}

export interface AuditStatus {
  readonly written: number;
  /** Rows that could not be written. Non-zero means the audit trail has holes in it. */
  readonly dropped: number;
}

export interface TranscriptsStatus {
  readonly tracked: number;
  /** Lines of a known type this build does not read. Most of a transcript. Not a problem. */
  readonly ignored: number;
  /** Lines of a type never observed — the number that climbs after a `claude update` (SPEC §8 R2). */
  readonly unknown: number;
  readonly oversize: number;
}

/** The newest vitals for one session, as the status table's columns and no more. */
export interface SessionVitalsLine {
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
  /** When this render was received, epoch ms. What makes a stale reading visible as stale. */
  readonly at: number;
  readonly sessionName: string | undefined;
  readonly modelName: string | undefined;
  /** Percent of the context window used, or `undefined` before the first turn — never `0`. */
  readonly usedPercentage: number | undefined;
  readonly costUsd: number | undefined;
  readonly fiveHourPercentage: number | undefined;
  readonly sevenDayPercentage: number | undefined;
}

export interface CoreStatus {
  readonly version: string;
  readonly runtime: RuntimeFacts;
  readonly tokenPath: string;
  readonly ingestKeyPath: string;
  /** Where `claude.exe` was found, or `undefined` — panes on sessions need it, shells do not. */
  readonly claudePath: string | undefined;
  readonly store: StoreStatus;
  readonly audit: AuditStatus;
  readonly transcripts: TranscriptsStatus;
  readonly vitals: readonly SessionVitalsLine[];
}

/**
 * One status body, or `undefined` if it is not one.
 *
 * The CLI reads this off a socket, so it is `unknown` until proven (CODING-STANDARDS §11 rule 1) —
 * even though the thing on the other end is core itself. The value of the rule is that a core one
 * version ahead of the script answers "I do not understand this" rather than printing `undefined`
 * in six columns.
 *
 * @throws never.
 */
export function parseCoreStatus(value: unknown): CoreStatus | undefined {
  const body = asRecord(value);
  if (body === undefined) return undefined;
  const version = stringAt(body, 'version');
  const runtime = runtimeOf(asRecord(body['runtime']));
  const store = storeOf(asRecord(body['store']));
  const audit = auditOf(asRecord(body['audit']));
  const transcripts = transcriptsOf(asRecord(body['transcripts']));
  const vitals = body['vitals'];
  if (version === undefined || runtime === undefined || store === undefined) return undefined;
  if (audit === undefined || transcripts === undefined || !Array.isArray(vitals)) return undefined;
  return {
    version,
    runtime,
    tokenPath: stringAt(body, 'tokenPath') ?? '',
    ingestKeyPath: stringAt(body, 'ingestKeyPath') ?? '',
    claudePath: stringAt(body, 'claudePath'),
    store,
    audit,
    transcripts,
    vitals: vitals
      .map(vitalsLineOf)
      .filter((line): line is SessionVitalsLine => line !== undefined),
  };
}

type Fields = Readonly<Record<string, unknown>>;

/**
 * The four blocks below are missing-or-whole rather than field-by-field optional, on purpose.
 *
 * A body with no `store` block is a core this script does not understand, which is worth refusing
 * out loud. A `store` block whose `stored` is not a number is a bug in something that had the
 * number, and a counter has exactly one honest resting value — so that one falls back to zero
 * rather than taking the whole screen down with it.
 */
function runtimeOf(runtime: Fields | undefined): RuntimeFacts | undefined {
  if (runtime === undefined) return undefined;
  return {
    pid: numberAt(runtime, 'pid') ?? 0,
    uptimeSeconds: numberAt(runtime, 'uptimeSeconds') ?? 0,
    nodeVersion: stringAt(runtime, 'nodeVersion') ?? 'unknown',
  };
}

function storeOf(store: Fields | undefined): StoreStatus | undefined {
  if (store === undefined) return undefined;
  return {
    path: stringAt(store, 'path') ?? '',
    schemaVersion: numberAt(store, 'schemaVersion') ?? 0,
    stored: numberAt(store, 'stored') ?? 0,
    snapshots: numberAt(store, 'snapshots') ?? 0,
    dropped: numberAt(store, 'dropped') ?? 0,
  };
}

function auditOf(audit: Fields | undefined): AuditStatus | undefined {
  if (audit === undefined) return undefined;
  return { written: numberAt(audit, 'written') ?? 0, dropped: numberAt(audit, 'dropped') ?? 0 };
}

function transcriptsOf(transcripts: Fields | undefined): TranscriptsStatus | undefined {
  if (transcripts === undefined) return undefined;
  return {
    tracked: numberAt(transcripts, 'tracked') ?? 0,
    ignored: numberAt(transcripts, 'ignored') ?? 0,
    unknown: numberAt(transcripts, 'unknown') ?? 0,
    oversize: numberAt(transcripts, 'oversize') ?? 0,
  };
}

/** A line with no session id or an unknown subscription is dropped, never coerced. */
function vitalsLineOf(value: unknown): SessionVitalsLine | undefined {
  const line = asRecord(value);
  if (line === undefined) return undefined;
  const sessionId = stringAt(line, 'sessionId');
  const subscription = SUBSCRIPTION_IDS.find((id) => id === line['subscription']);
  if (sessionId === undefined || subscription === undefined) return undefined;
  return {
    sessionId,
    subscription,
    at: numberAt(line, 'at') ?? 0,
    sessionName: stringAt(line, 'sessionName'),
    modelName: stringAt(line, 'modelName'),
    usedPercentage: numberAt(line, 'usedPercentage'),
    costUsd: numberAt(line, 'costUsd'),
    fiveHourPercentage: numberAt(line, 'fiveHourPercentage'),
    sevenDayPercentage: numberAt(line, 'sevenDayPercentage'),
  };
}

/** As in the other contracts: an annotated return keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Fields | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Fields, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/** `undefined` is not zero, here as everywhere: a session before its first turn has no numbers. */
function numberAt(source: Fields, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

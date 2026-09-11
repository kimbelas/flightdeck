// One record of `claude agents --json`, as the binary actually emits it — RESEARCH.md F.2.1.
//
// Almost everything is optional, and that is measured rather than defensive. F.2.1 saw a live
// three-second-old session with `pid` and `state: working` and **no `status` at all**, and the two
// kinds carry different fields: background records have `id` and `state`, interactive ones have
// neither. So the guard admits a record on `sessionId` alone and lets every other field be absent.
//
// **An unknown shape never throws** (P1-T3). A Claude Code update that adds a field, renames a
// state or introduces a third `kind` must degrade to "a session I know less about", not to a core
// that crashes on the next sweep — the listing is read every 10 s and a throw there takes the deck
// down with it.
import {
  ACTIVITY_STATUSES,
  RUN_STATES,
  SESSION_KINDS,
  type ActivityStatus,
  type RunState,
  type SessionKind,
} from './session.ts';

export interface AgentRecord {
  readonly sessionId: string;
  /** The short id, background records only. The uuid's first segment (F.2.1). */
  readonly id: string | undefined;
  /** Presence is the liveness test — never inferred from `state` (D29). */
  readonly pid: number | undefined;
  readonly cwd: string | undefined;
  readonly kind: SessionKind | undefined;
  readonly name: string | undefined;
  readonly startedAt: number | undefined;
  readonly status: ActivityStatus | undefined;
  readonly state: RunState | undefined;
}

/**
 * Every record the listing carried that this build can name, in order.
 *
 * Records it cannot parse are **dropped, not thrown on** — `parsed` and `skipped` are reported
 * separately so a shape change is visible in the log instead of silent (SEC-DATA-2).
 */
export interface AgentListing {
  readonly records: readonly AgentRecord[];
  readonly skipped: number;
}

export function parseAgentListing(raw: string): AgentListing {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { records: [], skipped: 0 };
  }
  if (!Array.isArray(value)) return { records: [], skipped: 0 };

  const records: AgentRecord[] = [];
  let skipped = 0;
  for (const entry of value) {
    const record = parseRecord(entry);
    if (record === undefined) skipped += 1;
    else records.push(record);
  }
  return { records, skipped };
}

function parseRecord(entry: unknown): AgentRecord | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const sessionId = record['sessionId'];
  // The one required field. Without it there is nothing to key a session on.
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;

  return {
    sessionId,
    id: optionalString(record['id']),
    pid: optionalNumber(record['pid']),
    cwd: optionalString(record['cwd']),
    kind: oneOf(record['kind'], SESSION_KINDS),
    name: optionalString(record['name']),
    startedAt: optionalNumber(record['startedAt']),
    status: oneOf(record['status'], ACTIVITY_STATUSES),
    state: oneOf(record['state'], RUN_STATES),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Narrows to a known union member, or `undefined` for anything else.
 *
 * An unrecognised `kind` or `state` is the shape-change case: the record is kept and the field is
 * dropped, because knowing less about a session is better than losing it.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.find((candidate) => candidate === value);
}

// Turning a SQLite row back into a contract type — P1-T8.
//
// **A row is a boundary, and is narrowed rather than trusted** (CODING-STANDARDS §11.1). Not
// ceremony about our own schema: the file on disk may have been written by an older or a newer
// build, so a column that is the wrong type is exactly as possible here as a changed field in a
// hook body. Every mapper below answers with something valid or with a default, and none throws —
// one unreadable row must not take out the page of rows around it.
import type { AuditOutcome, AuditRow } from '../../../contracts/audit-row.ts';
import { EVENT_SOURCES, type EventSource, type FdEvent } from '../../../contracts/fd-event.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import type { VitalsSnapshot } from '../../../contracts/vitals-snapshot.ts';

/** A stored payload back to a value. A column that will not parse reads as absent, never throws. */
function decodePayload(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function toEvent(row: unknown): FdEvent {
  const fields = asRecord(row) ?? {};
  return {
    id: numberAt(fields, 'id'),
    at: numberAt(fields, 'at'),
    sessionId: stringAt(fields, 'session_id'),
    subscription: subscriptionOf(stringAt(fields, 'subscription')),
    source: sourceOf(stringAt(fields, 'source')),
    type: stringAt(fields, 'type'),
    payload: decodePayload(fields['payload']),
  };
}

export function toAudit(row: unknown): AuditRow {
  const fields = asRecord(row) ?? {};
  const reason = fields['reason'];
  return {
    id: numberAt(fields, 'id'),
    at: numberAt(fields, 'at'),
    who: stringAt(fields, 'who'),
    action: stringAt(fields, 'action'),
    target: stringAt(fields, 'target'),
    args: argsOf(fields['args']),
    outcome: outcomeOf(stringAt(fields, 'outcome')),
    reason: typeof reason === 'string' ? reason : undefined,
  };
}

export function toSnapshot(row: unknown): VitalsSnapshot {
  const fields = asRecord(row) ?? {};
  return {
    id: numberAt(fields, 'id'),
    at: numberAt(fields, 'at'),
    sessionId: stringAt(fields, 'session_id'),
    subscription: subscriptionOf(stringAt(fields, 'subscription')),
    usedPercentage: optionalNumber(fields['used_percentage']),
    contextWindowSize: optionalNumber(fields['context_window']),
    costUsd: optionalNumber(fields['cost_usd']),
    modelId: typeof fields['model_id'] === 'string' ? fields['model_id'] : undefined,
  };
}

/**
 * Rows come back from SQLite as `unknown` and are narrowed here rather than trusted.
 *
 * That is not ceremony about our own schema: the file on disk is one an older or newer build may
 * have written, and a row read out of it is as much a boundary as a hook body is (§11.1).
 */
/** `SubscriptionId` is closed and there are two of them; anything else is not from this build. */
function subscriptionOf(value: string): SubscriptionId {
  return value === 'isg' ? 'isg' : '365';
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function numberAt(fields: Readonly<Record<string, unknown>>, key: string): number {
  const value = fields[key];
  return typeof value === 'number' ? value : 0;
}

function stringAt(fields: Readonly<Record<string, unknown>>, key: string): string {
  const value = fields[key];
  return typeof value === 'string' ? value : '';
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * `EventSource` is closed (contracts/fd-event.ts), so a row carrying something else is from a
 * build that is not this one. `find` over the exported tuple narrows it without a cast.
 */
function sourceOf(value: string): EventSource {
  return EVENT_SOURCES.find((source) => source === value) ?? 'reconcile';
}

function outcomeOf(value: string): AuditOutcome {
  return value === 'refused' || value === 'failed' ? value : 'ok';
}

function argsOf(value: unknown): readonly string[] {
  if (typeof value !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

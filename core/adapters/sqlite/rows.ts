// Turning a SQLite row back into a contract type — P1-T8.
//
// **A row is a boundary, and is narrowed rather than trusted** (CODING-STANDARDS §11.1). Not
// ceremony about our own schema: the file on disk may have been written by an older or a newer
// build, so a column that is the wrong type is exactly as possible here as a changed field in a
// hook body. Every mapper below answers with something valid or with a default, and none throws —
// one unreadable row must not take out the page of rows around it.
import type { AuditOutcome, AuditRow } from '../../../contracts/audit-row.ts';
import { parseConfigDigest, type ConfigDigest } from '../../../contracts/config-snapshot.ts';
import { EVENT_SOURCES, type EventSource, type FdEvent } from '../../../contracts/fd-event.ts';
import {
  PROFILE_FUNCTIONS,
  PROMPT_SOURCES,
  type LaunchPreset,
  type ProfileFunction,
  type PromptSource,
} from '../../../contracts/launch-preset.ts';
import { projectName, type ProjectRecord } from '../../../contracts/project.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import type { VitalsSnapshot } from '../../../contracts/vitals-snapshot.ts';
import type { ConfigSnapshot } from '../../ports/store.ts';

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
 * One imported project — P3-T1.
 *
 * `name` is re-derived when the column is empty rather than handed back blank: a project row is a
 * standing permission and must survive a label that did not, and an unnamed entry in the deck's
 * list is a row nobody can identify well enough to forget.
 */
export function toProject(row: unknown): ProjectRecord {
  const fields = asRecord(row) ?? {};
  const path = stringAt(fields, 'path');
  const name = stringAt(fields, 'name');
  return {
    path,
    name: name === '' ? projectName(path) : name,
    importedAt: numberAt(fields, 'imported_at'),
  };
}

/**
 * One saved launch preset — P4-T1.
 *
 * `builtIn` is `false` on every row by construction: built-ins are computed and never stored
 * (`PresetCatalogue`), so a row in this table is one the owner saved. It is set here rather than
 * read from a column, because a column whose value is always the same is a column that can
 * eventually hold something else.
 *
 * A row whose `profile_fn` or `prompt_source` is not from this build reads as the safe end of each
 * union rather than being dropped: `claude-365` starts nothing destructive and `literal` sends the
 * text as written. Losing the row entirely would take a button off the deck with nothing said.
 */
export function toPreset(row: unknown): LaunchPreset {
  const fields = asRecord(row) ?? {};
  const held = fields['preset_group'];
  return {
    projectKey: stringAt(fields, 'project_key'),
    id: stringAt(fields, 'id'),
    name: stringAt(fields, 'name'),
    profileFn: profileFnOf(stringAt(fields, 'profile_fn')),
    cwd: stringAt(fields, 'cwd'),
    sessionName: stringAt(fields, 'session_name'),
    promptSource: promptSourceOf(stringAt(fields, 'prompt_source')),
    prompt: stringAt(fields, 'prompt'),
    group: typeof held === 'string' && held !== '' ? held : undefined,
    builtIn: false,
  };
}

function profileFnOf(value: string): ProfileFunction {
  return PROFILE_FUNCTIONS.find((known) => known === value) ?? 'claude-365';
}

function promptSourceOf(value: string): PromptSource {
  return PROMPT_SOURCES.find((known) => known === value) ?? 'literal';
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

/**
 * One config snapshot — P3-T7.
 *
 * The digest is a TEXT column holding JSON, so it goes back through `parseConfigDigest` rather
 * than being trusted: a row written by an older build, or by a build that knew a facet this one
 * does not, comes back as the facets this build understands and nothing throws. That is the same
 * rule every payload in this file follows.
 */
export function toConfigSnapshot(row: unknown): ConfigSnapshot {
  const fields = asRecord(row) ?? {};
  return {
    id: numberAt(fields, 'id'),
    projectKey: stringAt(fields, 'project_key'),
    takenAt: numberAt(fields, 'taken_at'),
    digest: parseConfigDigest(jsonAt(fields, 'digest')) ?? EMPTY_DIGEST,
  };
}

/** What a row this build cannot read at all comes back as. Compares unequal to every real one. */
const EMPTY_DIGEST: ConfigDigest = {
  instructions: [],
  agents: [],
  commands: [],
  skills: [],
  hooks: [],
  servers: [],
  plugins: [],
  marketplaces: [],
  permissions: [],
  conventions: [],
  gates: [],
};

/** A TEXT column holding JSON. Unparseable is `undefined`, never a throw. */
function jsonAt(fields: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = fields[key];
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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

// `claude doctor`, narrowed to what the deck may draw — P4-T5, SEC-DATA-2, SEC-UI-2.
//
// **The reason this is a parser and not a `<pre>` is one line of the real output**
// (RESEARCH.md F.10.1):
//
//     Path: C:\Users\<account>\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
//
// That is the Windows account name, in the same screen `contracts/core-status.ts` already refuses
// to put `transcriptPath` on. Showing doctor's output verbatim would undo that control for the
// sake of a convenience. So the output is read into named fields, by a closed list of keys, and
// **anything not on the list is dropped** — which also means a line added by a future version is
// excluded by default rather than published by default.
//
// **`Auto-updates: enabled` is the finding that shapes the whole task.** The roadmap asked for a
// `claude update` button on the assumption that somebody has to press one; the binary updates
// itself and `Last update attempt` says when it last did (F.10.1). The button is a "check now",
// not a necessity, and the panel says so rather than implying the owner is behind.
//
// **Every value is capped, and none is composed here.** These strings come off another program's
// stdout and end up in a browser.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

export const MAX_HEALTH_VALUE_CHARS = 120;
/** How many lines of `claude doctor` are read before the rest is ignored. It prints ~20. */
export const MAX_HEALTH_LINES = 200;

/**
 * The keys this build reads out of `claude doctor`.
 *
 * A closed list, and the omissions are the point. `Path` carries the account name (see the
 * header). `Managed settings` and `Organization policy` name the employer. What is left is what
 * answers "is this installation healthy and current", which is the question the chip asks.
 */
export const HEALTH_KEYS = [
  'Running',
  'Commit',
  'Platform',
  'Config install method',
  'Search',
  'Auto-updates',
  'Auto-update channel',
  'Last update attempt',
] as const;

export type HealthKey = (typeof HEALTH_KEYS)[number];

export interface InstallHealth {
  readonly subscription: SubscriptionId;
  /** The keys above that this installation actually reported, in the order `doctor` printed them. */
  readonly fields: readonly HealthField[];
  /** True when `doctor` said it found none. `undefined` when it did not say either way. */
  readonly healthy: boolean | undefined;
  /** Whether the binary keeps itself current — the reason the update button is a convenience. */
  readonly autoUpdates: boolean | undefined;
}

export interface HealthField {
  readonly key: HealthKey;
  readonly value: string;
}

/** What `POST /update` answers. `changed` is false for the ordinary "already up to date". */
export interface UpdateResult {
  readonly subscription: SubscriptionId;
  readonly changed: boolean;
  /** The version after the attempt, or `undefined` when the output did not name one. */
  readonly version: string | undefined;
}

/**
 * `claude doctor`'s stdout, as fields.
 *
 * The format is `Key: value` per line with free text either side of it, so this reads lines rather
 * than parsing a document — there is no document. A line whose key is not in `HEALTH_KEYS` is
 * skipped, which is the SEC-DATA-2 control and not a tidiness preference.
 *
 * @throws never.
 */
export function parseInstallHealth(subscription: SubscriptionId, stdout: string): InstallHealth {
  const lines = stdout.split(/\r?\n/u).slice(0, MAX_HEALTH_LINES);
  const fields: HealthField[] = [];
  for (const line of lines) {
    const field = fieldOf(line);
    if (field !== undefined && !fields.some((held) => held.key === field.key)) fields.push(field);
  }
  return {
    subscription,
    fields,
    healthy: healthyFrom(lines),
    autoUpdates: autoUpdatesFrom(fields),
  };
}

/** One `Key: value` line, if its key is one this build publishes. */
function fieldOf(line: string): HealthField | undefined {
  const at = line.indexOf(':');
  if (at <= 0) return undefined;
  const key = HEALTH_KEYS.find((known) => known === line.slice(0, at).trim());
  if (key === undefined) return undefined;
  const value = line
    .slice(at + 1)
    .trim()
    .slice(0, MAX_HEALTH_VALUE_CHARS);
  return value === '' ? undefined : { key, value };
}

/**
 * Whether `doctor` declared the installation sound.
 *
 * `undefined` rather than `false` when it said neither, because "it did not say" and "it found
 * problems" are different things and only one of them is worth a warning on screen.
 */
function healthyFrom(lines: readonly string[]): boolean | undefined {
  const joined = lines.join('\n');
  if (joined.includes('No installation issues found')) return true;
  if (joined.includes('issue')) return false;
  return undefined;
}

function autoUpdatesFrom(fields: readonly HealthField[]): boolean | undefined {
  const value = fields.find((field) => field.key === 'Auto-updates')?.value;
  if (value === undefined) return undefined;
  return value === 'enabled';
}

/**
 * `claude update`'s stdout, as an outcome.
 *
 * **It cannot be trusted to be only its own output.** `update` runs a session lifecycle and fires
 * the `SessionEnd` hook, so with core down its stdout carries
 * `SessionEnd hook [http://127.0.0.1:4950/hooks] failed: connect ECONNREFUSED` — a line Flightdeck
 * caused, about Flightdeck, that would read on the deck as Claude being broken (F.10.2). Only the
 * two sentences this function names are read; the rest is dropped.
 *
 * @throws never.
 */
export function parseUpdateResult(subscription: SubscriptionId, stdout: string): UpdateResult {
  const version = /\((\d+\.\d+\.\d+)\)/u.exec(stdout)?.[1] ?? versionLine(stdout);
  return {
    subscription,
    // "up to date" is the ordinary answer and is NOT a change. Anything else that named a version
    // is treated as one, which errs towards telling the owner something happened.
    changed: !stdout.includes('is up to date') && version !== undefined,
    version,
  };
}

function versionLine(stdout: string): string | undefined {
  return /Current version:\s*(\d+\.\d+\.\d+)/u.exec(stdout)?.[1];
}

/** One health reading off the wire, or `undefined`. @throws never. */
export function parseInstallHealthReply(value: unknown): InstallHealth | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
  const held = fields['fields'];
  if (subscription === undefined || !Array.isArray(held)) return undefined;
  return {
    subscription,
    fields: held
      .map((entry: unknown) => healthFieldOf(entry))
      .filter((field): field is HealthField => field !== undefined),
    healthy: boolOrUndefined(fields['healthy']),
    autoUpdates: boolOrUndefined(fields['autoUpdates']),
  };
}

function healthFieldOf(value: unknown): HealthField | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const key = HEALTH_KEYS.find((known) => known === fields['key']);
  const held = fields['value'];
  if (key === undefined || typeof held !== 'string' || held === '') return undefined;
  return { key, value: held.slice(0, MAX_HEALTH_VALUE_CHARS) };
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

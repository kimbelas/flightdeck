// `flightdeck-core status` — the merged session table, and the counters nothing else prints.
//
// P1's gate sentence is this screen: *every live session with subscription, name, state, flags,
// model, context %, cost and 5h/7d quota*. Two requests make it, because two routes own the two
// halves and neither should own both — `GET /sessions` is the session table (the deck reads the
// same one), `GET /status` is what core knows about itself. They are joined here, by session id.
//
// **The join is outer on purpose.** A session in the listing with no vitals has not rendered a
// status line yet — ordinary, and its row still prints with dashes. A session with vitals and no
// row is the interesting direction: something is posting from a session `agents --json` does not
// list, which is worth seeing rather than dropping, so it prints with `?` for what the listing
// would have said.
//
// **Flags are derived from what is actually on the wire, and that is less than `deriveFlags`
// knows.** `SessionRow` carries no flags: the real derivation needs the entity, the event history
// and the vitals together (core/domain/session-flags.ts), and the vitals join that gives it to the
// deck is P2-T3. So this computes the three it can prove from a row plus a reading, and does not
// invent the other three. `wedged` in particular needs "silent for ten minutes", which is a fact
// about events this screen does not have.
import type { CoreStatus, SessionVitalsLine } from '../contracts/core-status.ts';
import { parseCoreStatus } from '../contracts/core-status.ts';
import { parseDeckSnapshot, type DeckSnapshot, type SessionRow } from '../contracts/session-row.ts';
import {
  HttpCoreClient,
  type CoreGetPath,
  type CoreResponse,
} from '../core/adapters/node/http-core-client.ts';
import { CONTEXT_PRESSURE_PERCENT } from '../core/domain/session-vitals.ts';
import { err, ok, type Result } from '../core/shared/result.ts';

/** Generous next to a 1 ms loopback answer; `/sessions` sweeps both subscriptions (~1.5 s). */
const TIMEOUT_MS = 8000;

export interface StatusReading {
  readonly status: CoreStatus;
  /**
   * The session table, or `undefined` when the sweep failed.
   *
   * Optional because the two halves fail independently and the counters are worth printing even
   * when `claude.exe` is not answering — which is one of the states somebody runs this in.
   */
  readonly sessions: DeckSnapshot | undefined;
}

/** One printed line: what the listing said, and what the status line said, for one session. */
interface Merged {
  readonly subscription: string;
  readonly shortId: string;
  readonly kind: string;
  readonly name: string;
  readonly state: string;
  readonly flags: string;
  readonly vitals: SessionVitalsLine | undefined;
}

/**
 * Asks core for both halves.
 *
 * @returns the reading, or the reason there is none — "core is not running" is an ordinary answer
 * here (RESEARCH.md F.3.3), not an exception.
 */
export async function readStatus(): Promise<Result<StatusReading, string>> {
  const client = new HttpCoreClient(TIMEOUT_MS);
  const status = await json(client, '/status');
  if (!status.ok) return err(status.error);
  const parsed = parseCoreStatus(status.value);
  if (parsed === undefined) return err('core answered /status with a body this build cannot read');
  const sessions = await json(client, '/sessions');
  return ok({
    status: parsed,
    sessions: sessions.ok ? parseDeckSnapshot(sessions.value) : undefined,
  });
}

/** The whole screen, as lines. Pure, so the layout is testable without a core to ask. */
export function renderStatus(reading: StatusReading, now: number): readonly string[] {
  const { status, sessions } = reading;
  return [
    `flightdeck-core ${status.version}   pid ${String(status.runtime.pid)}   ` +
      `up ${duration(status.runtime.uptimeSeconds * 1000)}   node ${status.runtime.nodeVersion}`,
    '',
    ...paths(status),
    '',
    ...counters(status),
    '',
    ...table(merge(status, sessions), now),
    '',
    ...footer(status, sessions, now),
  ];
}

function paths(status: CoreStatus): readonly string[] {
  return [
    `  token    ${status.tokenPath}`,
    `  ingest   ${status.ingestKeyPath}`,
    `  store    ${status.store.path}   schema ${String(status.store.schemaVersion)}`,
    `  claude   ${status.claudePath ?? 'NOT FOUND — session panes will refuse to open'}`,
  ];
}

/**
 * The five counters the P1-T6..T8 tasks left behind, and the three that mean something is wrong.
 *
 * `dropped` on either line and `unknown` on the transcript line are the numbers worth a second
 * look; they are printed with their own word rather than in a total, so a zero reads as a zero.
 */
function counters(status: CoreStatus): readonly string[] {
  const { store, audit, transcripts } = status;
  return [
    `  events   ${String(store.stored)} stored · ${String(store.snapshots)} snapshots · ` +
      `${String(store.dropped)} dropped${store.dropped > 0 ? '  <-- the store is failing' : ''}`,
    `  audit    ${String(audit.written)} written · ${String(audit.dropped)} dropped` +
      (audit.dropped > 0 ? '  <-- the audit trail has holes' : ''),
    `  feed 4   ${String(transcripts.tracked)} transcripts · ${String(transcripts.ignored)} ignored · ` +
      `${String(transcripts.unknown)} unknown · ${String(transcripts.oversize)} oversize` +
      (transcripts.unknown > 0 ? '  <-- run npm run transcript:probe' : ''),
  ];
}

/** The listing and the vitals, joined by session id, listing order first (attention, then age). */
function merge(status: CoreStatus, sessions: DeckSnapshot | undefined): readonly Merged[] {
  const byId = new Map(status.vitals.map((line) => [line.sessionId, line]));
  const rows = (sessions?.rows ?? []).map((row) => mergedRow(row, byId.get(row.sessionId)));
  for (const row of sessions?.rows ?? []) byId.delete(row.sessionId);
  return [...rows, ...[...byId.values()].map(orphan)];
}

function mergedRow(row: SessionRow, vitals: SessionVitalsLine | undefined): Merged {
  return {
    subscription: row.subscription,
    shortId: row.shortId,
    kind: row.kind === 'background' ? 'bg' : 'int',
    name: row.name ?? vitals?.sessionName ?? '—',
    state: stateOf(row),
    flags: flagsOf(row, vitals),
    vitals,
  };
}

/**
 * The two state axes as one column, with the absent one left out rather than dashed.
 *
 * Both are optional on a real record and for different reasons: an interactive session's listing
 * carries no `state` at all (RESEARCH.md F.2.1), and `status` is absent on most finished ones. The
 * first printing of this said `—/busy` for every live interactive session, which is a dash
 * standing in for a field that does not exist rather than one nobody filled in.
 */
function stateOf(row: SessionRow): string {
  return [row.runState, row.status].filter((part) => part !== undefined).join('/') || '—';
}

/** Vitals for a session the listing did not return. See the header: printed, not dropped. */
function orphan(vitals: SessionVitalsLine): Merged {
  return {
    subscription: vitals.subscription,
    shortId: vitals.sessionId.split('-')[0] ?? vitals.sessionId,
    kind: '?',
    name: vitals.sessionName ?? '—',
    state: 'not listed',
    flags: pressure(vitals) ? 'context-pressure' : '',
    vitals,
  };
}

/** The three flags a row plus a reading can prove. The other three need P2-T3 — see the header. */
function flagsOf(row: SessionRow, vitals: SessionVitalsLine | undefined): string {
  const flags: string[] = [];
  if (row.runState === 'blocked') flags.push('needs-you');
  if (pressure(vitals)) flags.push('context-pressure');
  if (row.live) flags.push('live');
  return flags.join(' ');
}

function pressure(vitals: SessionVitalsLine | undefined): boolean {
  const used = vitals?.usedPercentage;
  return used !== undefined && used >= CONTEXT_PRESSURE_PERCENT;
}

const HEADERS: readonly string[] = [
  'SUB',
  'ID',
  'KIND',
  'NAME',
  'STATE',
  'FLAGS',
  'MODEL',
  'CTX',
  'COST',
  '5H',
  '7D',
  'AGE',
];

function table(merged: readonly Merged[], now: number): readonly string[] {
  if (merged.length === 0) return ['  no sessions on either subscription'];
  const cells = merged.map((row) => [
    row.subscription,
    row.shortId,
    row.kind,
    row.name,
    row.state,
    row.flags,
    row.vitals?.modelName ?? '—',
    percent(row.vitals?.usedPercentage),
    money(row.vitals?.costUsd),
    percent(row.vitals?.fiveHourPercentage),
    percent(row.vitals?.sevenDayPercentage),
    row.vitals === undefined ? '—' : duration(now - row.vitals.at),
  ]);
  const widths = HEADERS.map((header, column) =>
    Math.max(header.length, ...cells.map((row) => row[column]?.length ?? 0)),
  );
  return [line(HEADERS, widths), ...cells.map((row) => line(row, widths))];
}

function line(cells: readonly string[], widths: readonly number[]): string {
  return `  ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ')}`.trimEnd();
}

function footer(
  status: CoreStatus,
  sessions: DeckSnapshot | undefined,
  now: number,
): readonly string[] {
  const lines: string[] = [];
  if (sessions === undefined) {
    lines.push('  sessions   UNREADABLE — the sweep failed; the counters above are still current');
  } else {
    const live = sessions.rows.filter((row) => row.live).length;
    lines.push(
      `  ${String(sessions.rows.length)} session(s), ${String(live)} live · ` +
        `${String(status.vitals.length)} with vitals · swept ${duration(now - sessions.takenAt)} ago`,
    );
    for (const subscription of sessions.unreadable) {
      // "No sessions" and "I could not look" are different answers (DeckQuery).
      lines.push(`  ${subscription}   UNREADABLE — this subscription's sweep failed`);
    }
  }
  return lines;
}

/** `—` rather than `0%`: a session before its first turn has no number (RESEARCH.md F.3.5). */
function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${String(Math.round(value))}%`;
}

function money(value: number | undefined): string {
  return value === undefined ? '—' : `$${value.toFixed(2)}`;
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * One route, parsed as JSON.
 *
 * The request itself belongs to `HttpCoreClient`, which builds it from constants and a closed set
 * of paths — this is only the JSON step and the two failures worth naming separately: a status
 * core did not like, and a body that is not JSON at all.
 */
async function json(client: HttpCoreClient, path: CoreGetPath): Promise<Result<unknown, string>> {
  const answer = await client.get(path);
  if (!answer.ok) return err(answer.error);
  return parseBody(answer.value, path);
}

function parseBody(response: CoreResponse, path: CoreGetPath): Result<unknown, string> {
  if (response.status !== 200) {
    // A 401 here means the token file is newer or older than the core holding the port — the
    // failure the `run` skill documents, and worth naming rather than reporting as "down".
    return err(`core answered ${String(response.status)} on ${path}`);
  }
  try {
    const body: unknown = JSON.parse(response.body);
    return ok(body);
  } catch {
    return err(`core answered ${path} with something that is not JSON`);
  }
}

// `GET /daemon` — what each subscription's background daemon is doing, on the wire. P7-T4.
//
// SPEC §6(13): "roster, spare workers, retire events per subscription". Three sources, joined in
// core: `daemon/roster.json` narrowed to its field allowlist (SEC-FS-1, D24), a process probe on the
// pids it names, and the tail of `daemon.log` (contracts/daemon-log.ts). What leaves core is only
// what the panel draws — no `cwd`, no prompt, no pipe name — so a field the roster grows in the
// next release has no path to the page.
//
// **The supervisor's state is the headline, and `stale` is the state that matters.** A roster
// naming a supervisor that has gone is RESEARCH.md F.2.16: `stop`, `rm` and `logs` all fail against
// the missing control pipe until a new `--bg` launch starts a daemon, and their error messages say
// "try again in a moment" about a condition that never resolves. The deck can show a session it
// cannot act on (`agents --json` keeps working), and this is how it says why.
import { SUBSCRIPTION_IDS, type EndReason, type SubscriptionId } from './session.ts';

/**
 * `running` — the roster's supervisor is alive and the log has not seen it exit.
 * `stale` — the roster names a supervisor that is dead, or that the log saw shut down (F.2.16).
 * `absent` — no roster names one, and the log shows no supervisor still up.
 */
export type SupervisorState = 'running' | 'stale' | 'absent';
export const SUPERVISOR_STATES: readonly SupervisorState[] = ['running', 'stale', 'absent'];

export interface DaemonSupervisor {
  readonly state: SupervisorState;
  /** The pid the roster names, or the log's still-open start when there is no roster. */
  readonly pid: number | undefined;
  /** When the roster was last written, epoch ms — how long a stale roster has been stale. */
  readonly rosterUpdatedAt: number | undefined;
  /** The log's most recent supervisor start, whichever pid it had. */
  readonly startedAt: number | undefined;
  readonly version: string | undefined;
  /** When that supervisor shut down, and why (`idle_exit`, `upgrade`), if it has. */
  readonly exitedAt: number | undefined;
  readonly exitCause: string | undefined;
}

/** One roster worker, reduced to what the panel draws. */
export interface DaemonWorker {
  readonly shortId: string;
  readonly pid: number | undefined;
  /** Whether that pid is a process now. A worker of a stale roster is usually not. */
  readonly alive: boolean;
  readonly startedAt: number | undefined;
  readonly cliVersion: string | undefined;
}

/**
 * How one background session ended, from the log — the `EndReason` the listing cannot supply.
 *
 * `retireReason` is the daemon's word: `settled` (it had finished), `idle-prompt` (it was BLOCKED,
 * waiting for the owner — an abandoned request for attention, not a completion) and `empty-idle`
 * (it never ran a turn). `idleMinutes` is what the line printed, which F.2.15 measured as the
 * session's age: an upper bound on idleness.
 */
export type DaemonEnding =
  | {
      readonly shortId: string;
      readonly at: number;
      readonly reason: Extract<EndReason, 'stopped' | 'finished'>;
    }
  | {
      readonly shortId: string;
      readonly at: number;
      readonly reason: Extract<EndReason, 'retired'>;
      readonly retireReason: string;
      readonly idleMinutes: number;
      readonly lowMemory: boolean;
    };

export interface SubscriptionDaemon {
  readonly subscription: SubscriptionId;
  readonly supervisor: DaemonSupervisor;
  readonly workers: readonly DaemonWorker[];
  /** Newest first, at most `MAX_WIRE_ENDINGS`. */
  readonly endings: readonly DaemonEnding[];
  /** False when `daemon.log` could not be read at all — no file yet, or refused. */
  readonly logRead: boolean;
}

export interface DaemonReport {
  readonly at: number;
  readonly daemons: readonly SubscriptionDaemon[];
}

const MAX_WIRE_ENDINGS = 50;
const MAX_WIRE_WORKERS = 50;
const MAX_WORD_CHARS = 40;
const SHORT_ID = /^[0-9a-f]{8}$/u;

/** A reply from `GET /daemon`, checked. @throws never. */
export function parseDaemonReport(value: unknown): DaemonReport | undefined {
  const fields = asRecord(value);
  const at = fields?.['at'];
  const daemons = fields?.['daemons'];
  if (typeof at !== 'number' || !Number.isFinite(at) || !Array.isArray(daemons)) return undefined;
  return { at, daemons: daemons.flatMap((entry: unknown) => daemonOf(entry) ?? []) };
}

function daemonOf(value: unknown): SubscriptionDaemon | undefined {
  const fields = asRecord(value);
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields?.['subscription']);
  const supervisor = supervisorOf(fields?.['supervisor']);
  if (fields === undefined || subscription === undefined || supervisor === undefined) {
    return undefined;
  }
  return {
    subscription,
    supervisor,
    workers: listOf(fields['workers'], workerOf).slice(0, MAX_WIRE_WORKERS),
    endings: listOf(fields['endings'], endingOf).slice(0, MAX_WIRE_ENDINGS),
    logRead: fields['logRead'] === true,
  };
}

function supervisorOf(value: unknown): DaemonSupervisor | undefined {
  const fields = asRecord(value);
  const state = SUPERVISOR_STATES.find((one) => one === fields?.['state']);
  if (fields === undefined || state === undefined) return undefined;
  return {
    state,
    pid: count(fields['pid']),
    rosterUpdatedAt: count(fields['rosterUpdatedAt']),
    startedAt: count(fields['startedAt']),
    version: word(fields['version']),
    exitedAt: count(fields['exitedAt']),
    exitCause: word(fields['exitCause']),
  };
}

function workerOf(value: unknown): DaemonWorker | undefined {
  const fields = asRecord(value);
  const shortId = shortIdOf(fields?.['shortId']);
  if (fields === undefined || shortId === undefined) return undefined;
  return {
    shortId,
    pid: count(fields['pid']),
    alive: fields['alive'] === true,
    startedAt: count(fields['startedAt']),
    cliVersion: word(fields['cliVersion']),
  };
}

function endingOf(value: unknown): DaemonEnding | undefined {
  const fields = asRecord(value);
  const shortId = shortIdOf(fields?.['shortId']);
  const at = count(fields?.['at']);
  const reason = fields?.['reason'];
  if (fields === undefined || shortId === undefined || at === undefined) return undefined;
  if (reason === 'stopped' || reason === 'finished') return { shortId, at, reason };
  return reason === 'retired' ? retirementOf(fields, shortId, at) : undefined;
}

function retirementOf(
  fields: Readonly<Record<string, unknown>>,
  shortId: string,
  at: number,
): DaemonEnding {
  return {
    shortId,
    at,
    reason: 'retired',
    retireReason: word(fields['retireReason']) ?? 'unknown',
    idleMinutes: count(fields['idleMinutes']) ?? 0,
    lowMemory: fields['lowMemory'] === true,
  };
}

function listOf<T>(value: unknown, each: (entry: unknown) => T | undefined): readonly T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => each(entry) ?? []);
}

function shortIdOf(value: unknown): string | undefined {
  return typeof value === 'string' && SHORT_ID.test(value) ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function word(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return value.slice(0, MAX_WORD_CHARS);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

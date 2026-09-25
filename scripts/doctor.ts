// `npm run doctor` — the verdicts, SEC-OPS-1. The IO and the printing are in doctor-cli.ts.
//
// SEC-OPS-1 names what it verifies: binds are loopback, the token file ACL, no `.key` file
// readable by core's allowlist, hooks blocks match the template, Claude Code version, Node
// version, ports. P1-T12 adds the three the tasks since then earned — the store's ACL (SEC-FS-4,
// which P1-T8 shipped without), the logon task's shape (SEC-OPS-3, D21) and the two counters that
// only mean something when they are not zero. P8-T1 adds the deck's task beside core's, the node
// each one runs, and the build the deck's task serves.
//
// **Split the way every probe here is split**: this file decides, `doctor-cli.ts` looks things up
// and prints. Each verdict is a pure function of what was found, which is the only way to have a
// test for "a `.key` file must be refused" that does not depend on one existing on the machine.
//
// **Three levels, and `warn` is not a soft `fail`.** `fail` means a control is broken and the exit
// code says so. `warn` means something is absent that a working machine may legitimately not have
// — core not running while somebody debugs, the logon task on a checkout that is not the owner's.
// Anything that would silently weaken a SEC control is a `fail`.
import {
  ephemeralDirectory,
  startsUnderCmd,
} from '../core/adapters/windows/logon-task-definition.ts';
import type { ConnectPlan } from '../contracts/connect-plan.ts';
import type { CoreStatus } from '../contracts/core-status.ts';
import type { AclFacts } from '../core/ports/file-acl.ts';
import type { LogonTaskState } from '../core/ports/logon-task.ts';
import type { ReadPolicy } from '../core/domain/read-policy.ts';

export type Level = 'ok' | 'warn' | 'fail';

export interface Check {
  readonly name: string;
  readonly level: Level;
  readonly detail: string;
}

/** The engines field is the one statement of what Node this project needs (package.json). */
export function nodeCheck(running: string, engines: string): Check {
  const required = Number(/>=\s*(\d+)/.exec(engines)?.[1] ?? NaN);
  const major = Number(/^v?(\d+)/.exec(running)?.[1] ?? NaN);
  if (!Number.isFinite(required) || !Number.isFinite(major)) {
    return fail('node', `could not read a version from ${running} against ${engines}`);
  }
  if (major < required) {
    // `node:sqlite` and native type stripping are both why (D9, BUILD-PLAN §1).
    return fail('node', `${running} is below the required ${engines}`);
  }
  return ok('node', `${running} satisfies ${engines}`);
}

/**
 * SEC-NET-1 — a port must be held on loopback and on nothing else.
 *
 * `next start` defaults to `0.0.0.0` and put the deck on the LAN once already (RESEARCH.md G.6),
 * which is why a wildcard bind is a `fail` and not a note.
 */
export function loopbackCheck(name: string, netstat: string, port: number, needed: boolean): Check {
  const addresses = listeningOn(netstat, port);
  if (addresses.length === 0) {
    const detail = `nothing is listening on port ${String(port)}`;
    return needed ? fail(name, detail) : warn(name, `${detail} — not running`);
  }
  const exposed = addresses.filter((address) => !isLoopback(address));
  if (exposed.length > 0) {
    return fail(name, `bound beyond loopback: ${exposed.join(', ')} — SEC-NET-1`);
  }
  return ok(name, `${addresses.join(', ')} — loopback only`);
}

/**
 * SEC-FS-4 — exactly one grant, to this user.
 *
 * "Exactly one" is the assertion that matters. A file that grants the owner *and* Administrators
 * reads as fine in every way except the one the control is about, and that is the state
 * `/inheritance:r` alone leaves it in where the parent's ACEs are explicit (windows-file-acl.ts).
 */
export function aclCheck(name: string, facts: AclFacts, account: string): Check {
  if (!facts.exists) {
    return warn(name, `${facts.path} is not there yet — core has not run on this machine`);
  }
  const others = facts.grants.filter((grant) => !sameAccount(grant.account, account));
  if (others.length > 0) {
    return fail(name, `also granted to ${others.map((grant) => grant.account).join(', ')}`);
  }
  if (facts.grants.length === 0) {
    // A grant to an empty account plus `/inheritance:r` is a file nobody can read, including us.
    return fail(name, `no grant at all — ${facts.path} is unreadable by its own owner`);
  }
  return ok(name, `${account} only (${facts.grants.map((grant) => grant.rights).join(' ')})`);
}

/**
 * SEC-OPS-1's "no `.key` file readable by core's allowlist", against the policy itself.
 *
 * `candidates` is deliberately a mix: the paths SEC-FS-2 names, whether or not they exist, plus
 * every secret actually found on this machine. The named ones keep the check from passing
 * vacuously on a machine that happens to have none — the failure shape P1-T13's notes call out in
 * the coverage table and P0-T9's scrubber had for real.
 */
export function secretsCheck(policy: ReadPolicy, candidates: readonly string[]): Check {
  const allowed = candidates.filter((path) => policy.allows(path));
  const first = allowed[0];
  if (first !== undefined) {
    return fail('secrets', `core's allowlist would open ${String(allowed.length)}: ${first}`);
  }
  return ok('secrets', `${String(candidates.length)} secret path(s) refused by ReadPolicy`);
}

/** SEC-OPS-1 — the blocks match the template when Connect has nothing left to change. */
export function hooksCheck(plan: ConnectPlan): Check {
  if (!plan.ok) {
    return fail('hooks', plan.refusals.map((refusal) => refusal.reason).join('; '));
  }
  if (plan.changes.length > 0 || plan.environment !== 'none') {
    const files = plan.changes.map((change) => change.label);
    const environment = plan.environment === 'none' ? [] : [plan.environmentLabel];
    // Not a fail: a machine that was never connected is not a broken machine (SEC-OPS-2).
    return warn(
      'hooks',
      `not connected — npm run connect would change ${[...files, ...environment].join(', ')}`,
    );
  }
  return ok('hooks', `${String(plan.alreadyDone.length)} block(s) match the template`);
}

/**
 * SEC-OPS-3 and D21 — the task exists, is not elevated, and stores no credential.
 *
 * **"Not elevated" is checked as the absence of `HighestAvailable`, not the presence of
 * `LeastPrivilege`, and that is a measurement rather than a preference** (RESEARCH.md G.17). Task
 * Scheduler omits default values when it exports a definition, and least privilege is the default:
 * a correctly registered task comes back with no `<RunLevel>` element at all. The first version of
 * this check asserted the positive form and failed on the very task the installer had just
 * written — found by registering one under a probe name and reading it back.
 */
export function logonTaskCheck(state: LogonTaskState, name = 'logon task'): Check {
  if (!state.installed || state.definition === undefined) {
    // A dead receiver makes every interactive session wear a hook error on every turn (F.1.5), so
    // this is the check that decides whether hooks are safe to leave installed across a reboot.
    return warn(name, `"${state.name}" is not registered — npm run task:install -- --apply`);
  }
  const problems: string[] = [];
  if (!state.definition.includes('<LogonType>InteractiveToken</LogonType>')) {
    problems.push('not "run only when logged on"');
  }
  if (state.definition.includes('HighestAvailable')) problems.push('runs elevated');
  // The one failure that looks like success: a registered task pointing at a node a version
  // manager deletes with the shell it was installed from (logon-task-definition.ts).
  const ephemeral = ephemeralDirectory(state.definition);
  if (ephemeral !== undefined) problems.push(`points into ${ephemeral}, gone by the next logon`);
  if (problems.length > 0) return fail(name, `${problems.join(' and ')} — SEC-OPS-3`);
  if (!startsUnderCmd(state.definition)) {
    // Registered and shaped right and has never started once (logon-task-definition.ts, G.57).
    return fail(
      name,
      `cmd /c strips its quotes and never starts node — npm run task:install -- --apply`,
    );
  }
  const node = taskNodePath(state.definition) ?? 'node path not found in the definition';
  return ok(name, `"${state.name}" — at logon, interactive token, least privilege, ${node}`);
}

/**
 * The node a registered task runs, read out of its `<Arguments>`.
 *
 * Reported because it is version-pinned on purpose (install-task-cli.ts) — after a Node upgrade the
 * tasks keep the old one until they are re-registered, and this line is where that shows.
 * Task Scheduler may hand the quotes back raw or as `&quot;`, so both are accepted.
 */
export function taskNodePath(definition: string): string | undefined {
  return /(?:"|&quot;)([^"&<>]*node\.exe)(?:"|&quot;)/i.exec(definition)?.[1];
}

/**
 * P8-T1 — the build the deck's task serves.
 *
 * The task never builds (deck-launch.ts), so a missing `.next` is the one way a registered deck
 * task fails at every logon without anything else looking wrong. A `fail` only when the task is
 * registered: without one, `flightdeck.cmd` builds before it starts and a missing build is
 * nothing but a fresh clone.
 */
export function deckBuildCheck(buildPresent: boolean, deckTaskInstalled: boolean): Check {
  if (buildPresent)
    return ok('deck build', '.next is built — the deck task has something to serve');
  const detail = 'no .next build — run flightdeck.cmd once, which builds';
  return deckTaskInstalled
    ? fail('deck build', `${detail}; the deck task exits at logon`)
    : warn('deck build', detail);
}

export function claudeCheck(path: string | undefined, version: string | undefined): Check {
  if (path === undefined) {
    return fail('claude', 'claude.exe not found — no listing, no panes (claude-install.ts)');
  }
  if (version === undefined) return warn('claude', `${path} — it did not answer --version`);
  return ok('claude', `${version} at ${path}`);
}

/** D9 — `node:sqlite` had no FTS5 before this machine's 26.3.0, so it is re-checked after upgrades. */
export function fts5Check(failure: string | undefined): Check {
  if (failure === undefined) return ok('fts5', 'node:sqlite compiled FTS5 in — P7 search is safe');
  return fail('fts5', `node:sqlite has no FTS5: ${failure} — D9's fallback is better-sqlite3 13.x`);
}

/**
 * SPEC §8 R2 — a transcript record type this build has never seen.
 *
 * The sample is the most recently WRITTEN transcripts, not the largest. The question is whether
 * Claude Code has started writing something new, and a new record type appears in what was written
 * yesterday; the biggest files are the oldest long conversations, which is the wrong end to look
 * at. The full corpus is `npm run transcript:probe 400` — 930 MB and 35 s on this machine, which
 * is more than a health check should cost.
 */
export function transcriptCheck(sampled: number, total: number, unknown: number): Check {
  const scope = `${String(sampled)} newest of ${String(total)}`;
  if (unknown > 0) {
    return fail('feed 4', `${String(unknown)} unknown record(s) in ${scope} — recapture fixtures`);
  }
  return ok('feed 4', `no unknown record types in ${scope}`);
}

/** The two counters that are only interesting when they are not zero (P1-T8). */
export function counterCheck(status: CoreStatus): Check {
  const problems: string[] = [];
  if (status.store.dropped > 0) problems.push(`${String(status.store.dropped)} event(s) dropped`);
  if (status.audit.dropped > 0) problems.push(`${String(status.audit.dropped)} audit row(s) lost`);
  if (problems.length > 0) return fail('counters', `${problems.join(', ')} — the store is failing`);
  return ok(
    'counters',
    `${String(status.store.stored)} events stored, ${String(status.audit.written)} audit rows, none dropped`,
  );
}

/** Non-zero if anything failed. `warn` does not fail the run — see the header. */
export function exitCodeFor(checks: readonly Check[]): number {
  return checks.some((check) => check.level === 'fail') ? 1 : 0;
}

export function renderChecks(checks: readonly Check[]): readonly string[] {
  const width = Math.max(...checks.map((check) => check.name.length));
  const marks: Readonly<Record<Level, string>> = { ok: ' ok ', warn: 'warn', fail: 'FAIL' };
  const lines = checks.map(
    (check) => `  [${marks[check.level]}] ${check.name.padEnd(width)}  ${check.detail}`,
  );
  const failed = checks.filter((check) => check.level === 'fail').length;
  const warned = checks.filter((check) => check.level === 'warn').length;
  return [
    ...lines,
    '',
    failed === 0 && warned === 0
      ? `  ${String(checks.length)} checks, all clear`
      : `  ${String(checks.length)} checks · ${String(failed)} failed · ${String(warned)} warning(s)`,
  ];
}

function ok(name: string, detail: string): Check {
  return { name, level: 'ok', detail };
}

function warn(name: string, detail: string): Check {
  return { name, level: 'warn', detail };
}

function fail(name: string, detail: string): Check {
  return { name, level: 'fail', detail };
}

/** Every local address holding `port` in LISTENING state, from `netstat -ano -p TCP`. */
function listeningOn(netstat: string, port: number): readonly string[] {
  const suffix = `:${String(port)}`;
  return netstat
    .split('\n')
    .filter((line) => line.includes('LISTENING'))
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter((address) => address.endsWith(suffix));
}

/** `127.0.0.1:4950` and `[::1]:4950` are loopback; `0.0.0.0:4950` and `[::]:4950` are not. */
function isLoopback(address: string): boolean {
  return address.startsWith('127.0.0.1:') || address.startsWith('[::1]:');
}

/** Windows account names are case-insensitive, and icacls prints them as it resolved them. */
function sameAccount(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

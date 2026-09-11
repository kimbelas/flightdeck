// SEC-FS-1 / SEC-FS-2 — the field allowlist for `daemon/roster.json`, in one place.
//
// DECISIONS.md D24: the allowlist unit for this file is the FIELD, not the file. The roster
// carries `rvAuth` and `ptyAuth` — 32 hex characters of pipe auth, equivalent to the `.key` files
// SEC-FS-2 forbids outright — and `dispatch`, which holds the full prompt text of every background
// session. Allowlisting the file would grant exactly what SEC-FS-2 exists to deny, only inline
// instead of in a sibling `.key`.
//
// This projection is deliberately an ALLOWLIST rather than a deny-list of those three names. A
// deny-list is wrong by default: it protects the fields someone thought of, and a roster that
// grows a fourth secret in a Claude Code update would leak it until somebody noticed. Everything
// not named here is discarded, including fields that do not exist yet.
//
// Two callers share it, which is why it lives in contracts/ rather than next to either: P1-T14's
// adapter, so nothing above the adapter can leak a field it never received, and
// scripts/roster-capture.ts, so the denied fields never reach `fixtures/raw/` — a git-ignored
// folder is still a file on disk, and SEC-FS-2 says never read, not never commit.

/** The fields of one background worker that may be read. Absent is normal — see P1-T3. */
export interface RosterWorker {
  readonly pid: number | undefined;
  readonly sessionId: string | undefined;
  readonly cwd: string | undefined;
  readonly startedAt: number | undefined;
  readonly cliVersion: string | undefined;
}

/**
 * The roster, reduced to what may leave the adapter.
 *
 * `supervisorPid` is on the list because it is the whole reason the file stays allowlisted at all:
 * a roster naming a `supervisorPid` that no longer exists is the signature of the state where
 * `stop`, `rm` and `logs` all fail permanently (RESEARCH.md F.2.16), which P7-T4 has to surface.
 */
export interface RosterView {
  readonly proto: number | undefined;
  readonly supervisorPid: number | undefined;
  readonly updatedAt: number | undefined;
  readonly workers: Readonly<Record<string, RosterWorker>>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function numberAt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function stringAt(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function projectWorker(source: Record<string, unknown>): RosterWorker {
  return {
    pid: numberAt(source, 'pid'),
    sessionId: stringAt(source, 'sessionId'),
    cwd: stringAt(source, 'cwd'),
    startedAt: numberAt(source, 'startedAt'),
    cliVersion: stringAt(source, 'cliVersion'),
  };
}

/**
 * Reduces a parsed `roster.json` to the allowlisted fields, discarding everything else.
 *
 * Takes `unknown` because the file is attacker-influenced like every other external shape
 * (SECURITY.md §3 rule 7) and is not validated anywhere upstream of this call. A roster that is
 * not an object at all yields an empty view rather than throwing: the daemon rewrites this file
 * while it runs, so a torn read is an ordinary event, not a bug to crash on.
 *
 * Each field is also type-checked, not merely named. That is the second half of the guarantee —
 * a name on the allowlist whose value arrived as an object (the shape `dispatch` has) is dropped
 * rather than copied through.
 */
export function projectRoster(parsed: unknown): RosterView {
  const source = asRecord(parsed);
  if (source === undefined) {
    return { proto: undefined, supervisorPid: undefined, updatedAt: undefined, workers: {} };
  }
  const workers = asRecord(source['workers']) ?? {};
  const projected: Record<string, RosterWorker> = {};
  for (const [id, worker] of Object.entries(workers)) {
    const record = asRecord(worker);
    if (record !== undefined) projected[id] = projectWorker(record);
  }
  return {
    proto: numberAt(source, 'proto'),
    supervisorPid: numberAt(source, 'supervisorPid'),
    updatedAt: numberAt(source, 'updatedAt'),
    workers: projected,
  };
}

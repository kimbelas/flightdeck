// What core is allowed to open under a config directory — SEC-FS-1 and SEC-FS-2, as code (P1-T12).
//
// The policy has existed in SECURITY.md since P0 and had no implementation: SEC-FS-2 ends with
// "a deny-list check runs before every open, and a test asserts it", and until this class there
// was neither. `scripts/doctor` is what made the absence impossible to ignore — SEC-OPS-1 asks it
// to verify that "no `.key` file is readable by core's allowlist", which needs the allowlist to be
// a thing rather than a paragraph.
//
// **The hole this closes is not theoretical.** Feed 4 learns which files to tail from
// `transcript_path` in a hook payload (P1-T7). `SubscriptionPaths` proves that path lies under one
// of the two config directories — and nothing more. A payload naming `daemon\control.key` as its
// transcript therefore passed attribution, and the file would have been opened, parsed and folded
// into a digest the deck displays. Both halves are needed: the root check says *whose*, this says
// *what*.
//
// **Pure string work, no `node:path`.** This is domain code (CODING-STANDARDS §2), and the rule it
// encodes is about names rather than about the filesystem: a real path is canonicalised by the
// adapter that owns it, and a policy that resolved paths itself would be a second opinion about
// `realpath`.
//
// **Only the config directories.** SEC-FS-1 also allowlists imported project folders; nothing
// reads one yet, and a rule for a caller that does not exist is a rule nobody can test. P3-T1 is
// the task that adds them.
//
// **P2-T4 is the first task to need a `.json` whose path carries an id**, and it is worth saying
// what did NOT happen. `jobs\<shortId>\state.json` answers "what does this session want from
// me" (RESEARCH.md F.2.4), and the deny rule refused it — SEC-FS-2 refuses every `.json` nobody has
// named. The fix is one narrow pattern, not a hole for `jobs\`: the deny rule is the half of
// SEC-FS-2 with value, since it is what makes the settings file of the NEXT Claude Code release
// unreadable until a person decides otherwise, and widening it to a whole directory would have
// traded that away for one filename's worth of convenience.

/** Files allowlisted by name, relative to a config directory (SEC-FS-1). */
const ALLOWED_FILES: readonly string[] = [
  'history.jsonl',
  'settings.json',
  'daemon.log',
  // Allowlisted as a FILE here and narrowed to five fields by the adapter that parses it — the two
  // halves of SEC-FS-1's "by field, not as a file" (P1-T14, DECISIONS.md D24).
  'daemon\\roster.json',
];

/** Directories whose non-secret contents are readable: transcripts, session and job state. */
const ALLOWED_DIRECTORIES: readonly string[] = ['sessions', 'jobs', 'projects'];

/**
 * The only `.json` files core may read. Everything else ending in `.json` under a config directory
 * is refused by SEC-FS-2, which is what keeps the next Claude Code release's new settings file
 * from being readable by default.
 */
const ALLOWED_JSON: readonly string[] = ['settings.json', 'daemon\\roster.json'];

/**
 * The `.json` files whose NAME is known but whose path carries an id —
 * `jobs\<shortId>\state.json` (P2-T4, RESEARCH.md F.2.4).
 *
 * A second list rather than a glob library, and a second list rather than relaxing the rule for
 * `jobs\`. The deny rule is the valuable half of SEC-FS-2 — it is what makes a `.json` the next
 * Claude Code release invents unreadable until somebody names it here — so the exception has to be
 * as narrow as the one file it exists for. `*` stands for exactly one segment, so the pattern
 * admits that file and nothing deeper, nothing shallower, and no sibling.
 */
const ALLOWED_JSON_PATTERNS: readonly string[] = ['jobs\\*\\state.json'];

const SEPARATOR = '\\';

export class ReadPolicy {
  private readonly roots: readonly string[];

  /**
   * @param configDirs the subscriptions' config directories, from `ClaudeInstall.configDirFor`.
   * Passed as data rather than as the adapter, for the reason `SubscriptionPaths` is: this stays
   * inward-pointing and testable without a filesystem.
   */
  constructor(configDirs: readonly string[]) {
    this.roots = configDirs.filter((directory) => directory !== '').map(canonical);
  }

  /** Whether core may open this path. */
  public allows(path: string): boolean {
    return this.refusal(path) === undefined;
  }

  /**
   * Why this path is refused, or `undefined` if it is allowed.
   *
   * A reason rather than a boolean because both callers need one: the log line that says a payload
   * was ignored, and `doctor`, whose whole output is reasons. Deny rules are evaluated before
   * allow rules — fail closed (SECURITY.md §11 rule 6).
   */
  public refusal(path: string): string | undefined {
    const relative = this.relativeTo(canonical(path));
    if (relative === undefined) return 'outside both config directories';
    if (relative === '') return 'the config directory itself is not a file';
    if (relative.split(SEPARATOR).includes('..')) return 'contains .. after normalisation';
    const denial = denied(relative);
    if (denial !== undefined) return denial;
    if (ALLOWED_FILES.includes(relative)) return undefined;
    return allowedByDirectory(relative) ? undefined : 'not on the read allowlist (SEC-FS-1)';
  }

  /** The path with its config directory removed, or `undefined` if it is under neither. */
  private relativeTo(candidate: string): string | undefined {
    for (const root of this.roots) {
      if (candidate === root) return '';
      if (candidate.startsWith(root + SEPARATOR)) return candidate.slice(root.length + 1);
    }
    return undefined;
  }
}

/** SEC-FS-2, in the order of how badly a hit would end. */
function denied(relative: string): string | undefined {
  const name = basename(relative);
  if (relative.endsWith('.key')) return 'a .key file is never read (SEC-FS-2)';
  if (name.startsWith('.credentials')) return 'credentials are never read (SEC-FS-2)';
  if (relative.endsWith('.json') && !allowedJson(relative)) {
    return 'an unlisted .json under the config directory (SEC-FS-2)';
  }
  return undefined;
}

/** By exact name, or by one of the narrow id-bearing patterns. See `ALLOWED_JSON_PATTERNS`. */
function allowedJson(relative: string): boolean {
  if (ALLOWED_JSON.includes(relative)) return true;
  return ALLOWED_JSON_PATTERNS.some((pattern) => matches(pattern, relative));
}

/** `*` matches exactly one path segment. No `**`, deliberately — see `ALLOWED_JSON_PATTERNS`. */
function matches(pattern: string, relative: string): boolean {
  const wanted = pattern.split(SEPARATOR);
  const actual = relative.split(SEPARATOR);
  if (wanted.length !== actual.length) return false;
  return wanted.every((segment, index) => segment === '*' || segment === actual[index]);
}

/** A file inside an allowlisted directory — a transcript under `projects\<slug>\` and the like. */
function allowedByDirectory(relative: string): boolean {
  const segments = relative.split(SEPARATOR);
  const first = segments[0];
  return segments.length > 1 && first !== undefined && ALLOWED_DIRECTORIES.includes(first);
}

function basename(relative: string): string {
  return relative.split(SEPARATOR).at(-1) ?? relative;
}

/** Windows, so both separators appear and case does not matter (as in `SubscriptionPaths`). */
function canonical(path: string): string {
  return path.replaceAll('/', SEPARATOR).toLowerCase().replace(/\\+$/, '');
}

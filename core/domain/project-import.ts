// What a folder must be before it may become a project root — P3-T1, SEC-FS-1, DECISIONS.md D26.
//
// SEC-FS-1 names four checks and they do not all happen at the same moment, which is the thing
// this file exists to make explicit. Canonicalise with `realpath`; must be a directory; reject a
// path containing `..` after normalisation; reject one that resolves through a junction outside
// the root. The first three decide whether a folder may JOIN the allowlist and live here. The
// fourth is about a path READ later inside a root that was already admitted, and it cannot be
// decided by string work at all — it is `PathCanonicaliser` plus `ReadPolicy`, composed by
// `ProjectRegistry.resolve`.
//
// **Two screens, because `realpath` sits between them.** `refuseRequested` looks at what the owner
// typed, before anything touches the filesystem — so a request nobody should act on never becomes
// a syscall. `refuseCanonical` looks at what came back, which is a different string: the casing is
// the filesystem's, junctions and symlinks are gone, and `..` has been collapsed.
//
// **Pure string work, no `node:path`** — the rule `read-policy.ts` states and the reason this is
// domain code. Nothing here resolves, opens or stats anything.
//
// **A config directory can never be a project**, in any of the three directions: it is one, it is
// under one, or it contains one. The first two would be an attempt to route around SEC-FS-2 —
// `~/.claude-365` holds `.credentials.json`, the `.key` files and every transcript, and it is
// governed by a deny-list that the project rules deliberately do not carry. The third is the one
// that is easy to miss and the reason the check is not simply "is it equal": importing
// `C:\Users\belas` would put both config directories inside a project root, and every later reader
// of "this project's files" would walk into 1.1 GB of transcripts. `ReadPolicy` would still refuse
// each of those opens — it screens config-directory paths by the config-directory rules first,
// whatever else contains them — so this is the second of two locks rather than the only one. It is
// here because a project that can never be read is a confusing thing to let somebody import.
import { canonicalWindowsPath, isUnder, WINDOWS_SEPARATOR } from '../../contracts/windows-path.ts';
import { MAX_PROJECT_PATH_CHARS, type ImportRefusal } from '../../contracts/project.ts';

/** `C:\…`, `\\server\share\…`, or the extended forms of both. Anything else is not a root. */
const ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\)/i;

export class ProjectImport {
  private readonly configDirs: readonly string[];

  /**
   * @param configDirs both subscriptions' config directories, from `ClaudeInstall.configDirFor`.
   * Passed as data rather than as the adapter, for the reason `ReadPolicy` and `SubscriptionPaths`
   * are: this stays inward-pointing and testable without a filesystem. An empty entry is dropped
   * rather than treated as a root — a policy built before `ClaudeInstall` found a home must not
   * make every path a config directory.
   */
  constructor(configDirs: readonly string[]) {
    this.configDirs = configDirs.filter((directory) => directory !== '').map(canonicalWindowsPath);
  }

  /**
   * What the owner typed, screened before anything touches the filesystem.
   *
   * `traversal` is refused rather than collapsed, although `realpath` would collapse it a moment
   * later and the result would be a perfectly good folder. The refusal is the point: a path with
   * `..` in it is one somebody composed rather than one they picked, and SEC-FS-1 says to reject
   * it. Accepting it and canonicalising it away would make the audit row disagree with the request.
   *
   * @returns the refusal, or `undefined` if the request is worth a syscall.
   */
  public refuseRequested(raw: string): ImportRefusal | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return 'empty';
    if (trimmed.length > MAX_PROJECT_PATH_CHARS) return 'too_long';
    if (!ABSOLUTE.test(trimmed)) return 'not_absolute';
    const segments = canonicalWindowsPath(trimmed).split(WINDOWS_SEPARATOR);
    return segments.includes('..') ? 'traversal' : undefined;
  }

  /**
   * What `realpath` came back with.
   *
   * @param root the canonical path, exactly as it will be stored.
   * @param isDirectory whether it is one. A file is refused rather than reduced to its parent: the
   * owner names the folder they mean, and guessing at it would widen the allowlist by a directory
   * nobody asked for.
   * @returns the refusal, or `undefined` if this folder may be a project root.
   */
  public refuseCanonical(root: string, isDirectory: boolean): ImportRefusal | undefined {
    if (!isDirectory) return 'not_a_directory';
    const candidate = canonicalWindowsPath(root);
    const clash = this.configDirs.some(
      (configDir) => isUnder(candidate, configDir) || isUnder(configDir, candidate),
    );
    return clash ? 'config_directory' : undefined;
  }
}

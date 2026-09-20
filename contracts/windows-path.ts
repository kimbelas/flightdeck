// One spelling of "the same path", for every rule that compares two of them — P3-T1.
//
// Windows, so three things are true of a path and none of them is negotiable: both separators name
// the same folder, case does not matter, and a trailing separator is decoration. Two classes had
// already written this out privately — `ReadPolicy` (P1-T12) and `SubscriptionPaths` (P1-T5) — and
// the two spellings had already drifted: one stripped the trailing separator and the other did not.
// The project registry is the third caller, and a rule that decides what core may open is not one
// to hold three opinions about.
//
// **It is not `node:path`, and must not become it.** `contracts/` is the only folder both
// TypeScript projects compile, so this is in the browser bundle, and `core/domain/` may not import
// a Node built-in at all (CODING-STANDARDS §2). More to the point, this is not resolution:
// `resolve` would consult the process's working directory, and `normalize` would collapse `..` —
// which is the one segment `ReadPolicy` has to be able to SEE in order to refuse it. Resolving a
// real path is the job of the adapter that owns it (`PathCanonicaliser`, P3-T1); this only makes
// two strings comparable.

/** The separator every rule in this repository compares against. Windows-only by SPEC §1. */
export const WINDOWS_SEPARATOR = '\\';

/**
 * A path reduced to the form two of them can be compared in.
 *
 * Lossy on purpose — the result is a comparison key, never something to open or to show. What is
 * opened is what `realpath` came back with, and what is shown is what the owner typed.
 */
export function canonicalWindowsPath(path: string): string {
  return path.replaceAll('/', WINDOWS_SEPARATOR).toLowerCase().replace(/\\+$/, '');
}

/**
 * Whether `candidate` is `root` or lies under it, both already canonical.
 *
 * The separator is not fussiness: a bare `startsWith` reads `…\.claude-365-backup\…` as the `365`
 * config directory, and a folder some unrelated tool created starts being read as the owner's live
 * config (the `SubscriptionPaths` lesson, P1-T5).
 */
export function isUnder(candidate: string, root: string): boolean {
  if (root === '') return false;
  return candidate === root || candidate.startsWith(root + WINDOWS_SEPARATOR);
}

/**
 * `directory` and one entry inside it, joined with exactly one separator — P3-T2.
 *
 * Trivial everywhere except at a drive root, which is exactly where a template string gets it
 * wrong: `C:\` already ends in a separator, so `${directory}\\.git` composes `C:\\.git`, and
 * `canonicalWindowsPath` reads that as a different path from `c:\.git` — so the screen that is
 * supposed to allow it refuses it instead. A folder imported at a drive root is an odd thing to do
 * and not one that should quietly stop working.
 */
export function childPath(directory: string, name: string): string {
  return `${directory.replace(/[\\/]+$/, '')}${WINDOWS_SEPARATOR}${name}`;
}

/**
 * The folder above, or `undefined` at a root — P3-T2.
 *
 * Here rather than `node:path.dirname` for this file's standing reason: `contracts/` is compiled
 * into the browser bundle and `core/domain/` may not import a Node built-in at all. The walk that
 * needs it is the one `statusline.py`'s `git_dir()` does — climb until `.git` turns up — and
 * P3-T4 climbs the same way, so the stopping rule belongs in one place.
 *
 * **Casing is preserved**, unlike `canonicalWindowsPath`: the result is composed with and opened,
 * not compared, and a lower-cased path is only good for matching.
 *
 * Both roots terminate, which is the whole point of returning `undefined`: `C:\` has no parent,
 * and neither does `\\server\share` — a UNC share is the top of its tree, and walking past it
 * would ask the filesystem about `\\server`, which is not a directory.
 */
export function parentDirectory(path: string): string | undefined {
  const normalised = path.replaceAll('/', WINDOWS_SEPARATOR).replace(/\\+$/, '');
  const cut = normalised.lastIndexOf(WINDOWS_SEPARATOR);
  if (cut < 0) return undefined;
  const parent = normalised.slice(0, cut);
  // `C:\foo` climbs to `C:\`, which is a folder; `C:` on its own is a drive-relative reference and
  // is not one, so the separator is kept rather than trimmed with the others.
  if (/^[a-z]:$/i.test(parent)) return `${parent}${WINDOWS_SEPARATOR}`;
  if (parent === '' || parent === WINDOWS_SEPARATOR) return undefined;
  // `\\server\share` — a parent with nothing but a host left in it is the top of the tree.
  if (normalised.startsWith('\\\\') && !parent.slice(2).includes(WINDOWS_SEPARATOR)) {
    return undefined;
  }
  return parent;
}

/**
 * The last segment of a path — the folder's or file's own name — or `undefined` at a root.
 *
 * `parentDirectory`'s other half, and here for the same two reasons: `contracts/` is compiled into
 * the browser bundle so `node:path.basename` is not available to it, and the two halves of one
 * rule about where a path ends belong in one file. P3-T4 is the caller — `tree.mjs` names a
 * worktree by its directory, and recognising a linked worktree's administrative directory means
 * asking whether the segment above it is `worktrees`.
 *
 * **Casing is preserved**, like `parentDirectory`: the result is shown to a person — it is the
 * name the owner typed when they created the tree — and a lower-cased one is only good for
 * matching.
 */
export function lastSegment(path: string): string | undefined {
  const normalised = path.replaceAll('/', WINDOWS_SEPARATOR).replace(/\\+$/, '');
  const cut = normalised.lastIndexOf(WINDOWS_SEPARATOR);
  const segment = cut < 0 ? normalised : normalised.slice(cut + 1);
  // `C:\` reduces to `C:`, which is a drive reference and not a name — the same special case
  // `parentDirectory` makes in the other direction, and the reason both live in one file. Without
  // it a project imported at a drive root would be a worktree called `C:`.
  if (/^[a-z]:$/i.test(segment)) return undefined;
  return segment === '' ? undefined : segment;
}

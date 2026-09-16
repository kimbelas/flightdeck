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

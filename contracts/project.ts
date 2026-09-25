// An imported project, on the wire — P3-T1, DECISIONS.md D26, SEC-FS-1.
//
// **The registry ships empty and nothing scans the disk.** D26 settled it: Flightdeck is a lens
// over the machine rather than a container for it, so a folder becomes visible to core because the
// owner imported it in the deck and for no other reason. No discovery, no walk of `~/Documents`,
// no project list compiled into the build. That is not modesty about scanning — it is what keeps
// SEC-FS-1's allowlist honest, because an allowlist that grows by itself is one nobody can read
// back. It grows by one deliberate act at a time, and each act is an audit row.
//
// **A project IS a path, so there is no id.** BUILD-PLAN §3 sketches `Project.id`, and the sketch
// is dropped here rather than honoured with a hash or a counter. Importing the same folder twice
// has to be the same project, which makes the canonical path the natural key; a second identifier
// derived from it would be a value that can disagree with the thing it identifies, and one derived
// from nothing would make re-import a duplicate. `projectKey` is what a React list and a query
// string use, exactly as `sessionKey` is (contracts/session-row.ts). The BUILD-PLAN row is a
// sketch of a shape, not a promise about fields — the same reading `session-detail-route.ts` took
// of its `/sessions/:id`.
//
// **Everything here is capped on the way in.** A path arrives from a text box in the deck and ends
// up in a database, in a log line and on screen, so its length is bounded where it is parsed
// rather than wherever it is next used (the rule `job-state.ts` set). The name is derived, never
// accepted: a caller that could name a project could put anything on the owner's screen.
import { canonicalWindowsPath, WINDOWS_SEPARATOR } from './windows-path.ts';

/**
 * The longest path that may be imported.
 *
 * Not `MAX_PATH`. Windows has allowed 32 767 characters through the `\\?\` prefix for years and
 * long-path awareness is on by default for Node, so 260 would refuse folders that work perfectly
 * well. This is a guard against an absurd request body, not a platform limit.
 */
export const MAX_PROJECT_PATH_CHARS = 1024;

/** The longest derived name kept. A label in a list; a folder named longer than this is truncated. */
export const MAX_PROJECT_NAME_CHARS = 80;

/**
 * Why an import was refused.
 *
 * A closed union rather than a sentence, because both ends need it: core logs and audits the code,
 * and the deck turns it into English (`ProjectsViewModel`). A refusal that crossed the wire as
 * prose would be a string the deck could only display, never reason about.
 */
export const IMPORT_REFUSALS = [
  'empty',
  'not_absolute',
  'too_long',
  'traversal',
  'missing',
  'not_a_directory',
  'config_directory',
] as const;

export type ImportRefusal = (typeof IMPORT_REFUSALS)[number];

export interface ProjectRecord {
  /**
   * What `realpath` came back with — as the filesystem spells it, not as the owner typed it.
   *
   * Kept in the filesystem's casing rather than the comparison key's, because this is the value
   * that goes on screen and `c:\users\belas\documents\…` is not how anyone reads a path.
   */
  readonly path: string;
  /** The last segment of `path`, capped. Derived, never accepted — see the header. */
  readonly name: string;
  readonly importedAt: number;
}

/**
 * The key two references to the same folder share — `sessionKey`'s counterpart.
 *
 * Every comparison, every primary key and every lookup goes through this. `path` is what is shown;
 * this is what is matched.
 */
export function projectKey(path: string): string {
  return canonicalWindowsPath(path);
}

/**
 * The label for a folder: its last segment, capped.
 *
 * A drive root has no last segment and answers with the drive, which is the only sensible thing to
 * call it. Nothing downstream composes a path from this.
 */
export function projectName(path: string): string {
  // Separators only. NOT `projectKey`: that folds case, and a folder the owner named `AppNext`
  // must not appear in the deck as `appnext` because the comparison key happens to be lowercase.
  const segments = path
    .replaceAll('/', WINDOWS_SEPARATOR)
    .split(WINDOWS_SEPARATOR)
    .filter(isPresent);
  const last = segments.at(-1) ?? path;
  return last.slice(0, MAX_PROJECT_NAME_CHARS);
}

/** One record, or `undefined` if it is not one. @throws never. */
export function parseProject(value: unknown): ProjectRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const path = fields['path'];
  const importedAt = fields['importedAt'];
  if (typeof path !== 'string' || path === '' || path.length > MAX_PROJECT_PATH_CHARS) {
    return undefined;
  }
  if (typeof importedAt !== 'number' || !Number.isFinite(importedAt)) return undefined;
  const name = fields['name'];
  return {
    path,
    // Re-derived when it is missing rather than refused: the name is a label, and a row that lost
    // it is still a project the owner imported.
    name:
      typeof name === 'string' && name !== ''
        ? name.slice(0, MAX_PROJECT_NAME_CHARS)
        : projectName(path),
    importedAt,
  };
}

/**
 * The registry, from a `GET /projects` body.
 *
 * Drops what it cannot read rather than refusing the whole list — one unreadable row must not cost
 * the deck the other nine, which is the rule every parser in this folder follows.
 */
export function parseProjectList(value: unknown): readonly ProjectRecord[] {
  if (typeof value !== 'object' || value === null) return [];
  const projects: unknown = Object.fromEntries(Object.entries(value))['projects'];
  if (!Array.isArray(projects)) return [];
  return projects
    .map((entry: unknown) => parseProject(entry))
    .filter((project): project is ProjectRecord => project !== undefined);
}

/**
 * The one field in the body both project mutations take — `POST /projects` and its `/forget`.
 *
 * Here rather than in each route, and taking the raw text rather than a parsed value, for the
 * reason `session-ref.ts` gives about its query string: the deck builds this body and core screens
 * it, and two ends spelling one field differently is a 400 with no visible cause. A body that is
 * not JSON, is not an object, or carries no `path` string is one answer — there is no path here —
 * because `empty` is what the registry would have said about all three.
 *
 * @throws never.
 */
export function parseProjectPathBody(body: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const path: unknown = Object.fromEntries(Object.entries(value))['path'];
  return typeof path === 'string' && path.trim() !== '' ? path : undefined;
}

/** The refusal in an error body, or `undefined` for one this build does not know. @throws never. */
export function parseImportRefusal(value: unknown): ImportRefusal | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const error: unknown = Object.fromEntries(Object.entries(value))['error'];
  return IMPORT_REFUSALS.find((refusal) => refusal === error);
}

function isPresent(segment: string): boolean {
  return segment !== '';
}

/**
 * The directory Claude Code keeps a folder's transcripts in.
 *
 * Its own function because the spelling is Claude Code's and is observed rather than documented:
 * every separator and every colon becomes `-`, so `C:\Users\belas\Documents\development\flightdeck`
 * is `C--Users-belas-Documents-development-flightdeck`. Read off this machine's own `projects/`
 * directories (19 of them) rather than inferred from one example.
 *
 * In `contracts/` as of P7-T3, out of `ObservedReader`: the spend summary is keyed by the slug a
 * transcript sits in, and the deck matches it back to an imported folder with this same spelling.
 * **A dot becomes `-` too**, which the first reading missed: `xpert-new\.claude\worktrees\xweb-1941`
 * is `...-xpert-new--claude-worktrees-xweb-1941` in the isg dir, so every worktree under
 * `.claude\worktrees` had a slug this function could not produce (RESEARCH.md G.59).
 */
export function projectSlug(path: string): string {
  return path.replaceAll(/[\\/:.]/gu, '-');
}

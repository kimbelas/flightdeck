// What an imported folder looks like right now — P3-T2, SPEC §5.1.
//
// **A separate wire type, not fields on `ProjectRecord`.** BUILD-PLAN §3 sketches `stack` and
// `git` on `Project`, and the sketch is declined here for the same reason `SessionDetail` is not
// `SessionRow`: a `ProjectRecord` is a standing permission the owner granted and it is the one
// thing in the store that is not an observation (`core/ports/store.ts`), while this is a reading
// taken a moment ago that is wrong by the time anybody acts on it. Putting a branch name on the
// record would make "which folders may core read" a row that changes every time somebody commits,
// and the next reader would reasonably wonder which half of it survives a restart.
//
// **Nothing here is stored.** Git state is "now" and belongs in an in-memory cache keyed on the
// git directory's mtimes (`SignatureCache`), never in sqlite. The store holds what happened; this
// is what is true, and the two are different kinds of state.
//
// **`at` is when the reading was taken, not when it was asked for.** A cached answer carries the
// timestamp of the spawn that produced it, so a deck that wanted to draw "as of 3 s ago" could.
import { parseGitStatus, type GitStatus } from './git-status.ts';
import { MAX_PROJECT_PATH_CHARS } from './project.ts';

/**
 * The detected stack, in the order it is displayed.
 *
 * Frameworks before the runtime, deliberately: a repository with `next.config.ts` and
 * `package.json` has both, and "Next.js · Node" reads as the specific answer followed by the
 * general one, where the other order reads as an afterthought. Closed union rather than free text
 * for the reason `ImportRefusal` is one — core detects, the deck decides how to draw it, and
 * nothing on screen was composed from what is on disk.
 *
 * The five markers are SPEC §5.1's table and not a guess at what else might be interesting. A
 * label nobody named is a label nobody can check, and adding one later costs a line.
 */
export const STACK_LABELS = ['Next.js', 'Angular', '.NET', 'Docker', 'Node'] as const;

export type StackLabel = (typeof STACK_LABELS)[number];

/**
 * One label per marker filename, in display order.
 *
 * Names only — nothing here opens `package.json`. Reading dependencies out of it would be a
 * better detector and a worse boundary: it would make stack detection a JSON parse of a file an
 * imported repository controls, on every refresh, for a label. The presence of the file is what
 * SPEC §5.1 names, and it is one directory listing for all five.
 *
 * `Dockerfile.dev` and `Dockerfile.prod` count, because a repository that has only those still
 * builds a container. `.csproj` matches anywhere in the name because a solution names its project
 * after itself.
 */
const MARKERS: readonly { readonly label: StackLabel; readonly file: RegExp }[] = [
  { label: 'Next.js', file: /^next\.config\.[cm]?[jt]s$/i },
  { label: 'Angular', file: /^angular\.json$/i },
  { label: '.NET', file: /\.csproj$/i },
  { label: 'Docker', file: /^dockerfile(?:\..+)?$/i },
  { label: 'Node', file: /^package\.json$/i },
];

export interface ProjectStatus {
  /**
   * Which project this is about — the stored path, so the deck can match it to a row.
   *
   * The path rather than an index, because the list is read asynchronously and a reply that
   * arrived after an import would otherwise land against the wrong folder.
   */
  readonly path: string;
  /** When the reading was taken. See the header. */
  readonly at: number;
  /** Empty for a folder with none of the five markers — an ordinary answer, not a failure. */
  readonly stack: readonly StackLabel[];
  /**
   * `undefined` when there is no repository core can see.
   *
   * Two different things and deliberately one answer: the folder is not a git repository at all,
   * or it is one whose git directory lies outside every imported root — a linked worktree whose
   * main repository was never imported. Neither is something the panel can act on, and a deck
   * that distinguished them would be explaining SEC-FS-1 to somebody looking at a branch name.
   */
  readonly git: GitStatus | undefined;
}

/**
 * The labels for one directory listing, in `STACK_LABELS` order.
 *
 * @param entries the names directly inside the project root — not paths, and not recursive. A
 * marker in a subdirectory belongs to that subdirectory's project.
 */
export function detectStack(entries: readonly string[]): readonly StackLabel[] {
  return MARKERS.filter((marker) => entries.some((entry) => marker.file.test(entry))).map(
    (marker) => marker.label,
  );
}

/** One reading, from a `GET /projects/status` body. @throws never. */
export function parseProjectStatus(value: unknown): ProjectStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const path = fields['path'];
  const at = fields['at'];
  if (typeof path !== 'string' || path === '' || path.length > MAX_PROJECT_PATH_CHARS) {
    return undefined;
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  const git = fields['git'];
  return {
    path,
    at,
    stack: stackOf(fields['stack']),
    // Absent and unreadable are the same answer here: no repository to draw.
    git: git === undefined || git === null ? undefined : parseGitStatus(git),
  };
}

/**
 * Every reading, from a `GET /projects/status` body.
 *
 * Drops what it cannot read rather than refusing the whole list — one unreadable row must not cost
 * the deck the other nine, which is the rule every parser in this folder follows.
 *
 * @throws never.
 */
export function parseProjectStatusList(value: unknown): readonly ProjectStatus[] {
  if (typeof value !== 'object' || value === null) return [];
  const statuses: unknown = Object.fromEntries(Object.entries(value))['statuses'];
  if (!Array.isArray(statuses)) return [];
  return statuses
    .map((entry: unknown) => parseProjectStatus(entry))
    .filter((status): status is ProjectStatus => status !== undefined);
}

/** Only labels this build knows, in display order. Anything else is dropped rather than shown. */
function stackOf(value: unknown): readonly StackLabel[] {
  if (!Array.isArray(value)) return [];
  return STACK_LABELS.filter((label) => value.includes(label));
}

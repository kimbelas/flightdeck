// What git says about a project right now — P3-T2, SPEC §5.1, lifted from `statusline.py`.
//
// **One spawn answers four questions.** `git status --porcelain=v2 --branch -uno` prints the
// branch, the upstream divergence and a line per changed file in a single invocation, and
// `statusline.py` has run exactly that on every status line render for months (lines ~190–205).
// Asking `rev-parse --abbrev-ref`, then `rev-list --count`, then `status` would be three process
// spawns for one answer — on Windows, where a spawn is the expensive part, that is the whole cost
// of the feature paid three times.
//
// **`-uno` is not an optimisation, it is the answer changing.** Untracked files are excluded
// deliberately: `node_modules` in a repo without a `.gitignore` entry, a build directory, a
// scratch file — counting those would make "dirty" mean "there are files here" rather than "there
// is work here". It is also what keeps the command from walking the whole tree.
//
// **The parser is here rather than in `core/` for the reason `agents-listing.ts` is**: it reads
// one external tool's documented output shape, both ends need the type, and a parser in
// `contracts/` is one that can be tested with a string and nothing else.
//
// **Nothing here spawns anything or reads a file.** `progress` — mid-merge, mid-rebase — does not
// come from this output at all: it is the presence of a file in the git directory, which is what
// makes it worktree-safe and free (`ProjectGitReader`).

/**
 * An operation git is in the middle of.
 *
 * Worth surfacing because it changes what every other number means: 3 dirty files during a rebase
 * is a conflict to finish, not work in progress. `statusline.py` shows the same six states, and it
 * reads them off the filesystem rather than parsing them out of a command's output.
 */
export const GIT_PROGRESS_STATES = [
  'merging',
  'cherry-picking',
  'reverting',
  'rebasing',
  'bisecting',
] as const;

export type GitProgress = (typeof GIT_PROGRESS_STATES)[number];

/** What one `git status` spawn says. `progress` is not in here — see the header. */
export interface GitCounts {
  /**
   * The checked-out branch, or `undefined` on a detached HEAD.
   *
   * `undefined` rather than the literal `(detached)` git prints: that string is a sentinel in a
   * human-readable field, and a deck that rendered it would be showing git's placeholder as if it
   * were a branch name.
   */
  readonly branch: string | undefined;
  /** Commits HEAD has that its upstream does not. `0` when there is no upstream. */
  readonly ahead: number;
  readonly behind: number;
  /** Tracked files changed in the index or the working tree. Untracked are not counted — `-uno`. */
  readonly dirty: number;
  /** Unmerged paths. A non-zero count is a conflict somebody has to resolve. */
  readonly conflicts: number;
}

export interface GitStatus extends GitCounts {
  readonly progress: GitProgress | undefined;
}

/** Nothing known yet — what a repository with no output parses to. */
const NOTHING: GitCounts = {
  branch: undefined,
  ahead: 0,
  behind: 0,
  dirty: 0,
  conflicts: 0,
};

/** Git's own sentinel for "no branch", in the field a branch name would occupy. */
const DETACHED = '(detached)';

/**
 * The longest branch name kept.
 *
 * A branch name is bounded by git in practice but not by anything this code can rely on, and it
 * ends up on screen and in a log line. Capped where it is parsed rather than wherever it is next
 * used — the rule `job-state.ts` set.
 */
export const MAX_BRANCH_CHARS = 120;

/**
 * One `git status --porcelain=v2 --branch -uno` reading.
 *
 * Porcelain v2 is the format git documents as stable for scripts, which is the reason it is used
 * over the default: the human format is explicitly allowed to change between releases.
 *
 * The header lines are `# branch.head <name>` and `# branch.ab +<ahead> -<behind>`. `branch.ab` is
 * ABSENT when there is no upstream — measured, not assumed — so a branch nobody has pushed reads
 * as 0/0 rather than as unknown. Entry lines begin `1 ` (changed), `2 ` (renamed or copied) or
 * `u ` (unmerged); a `2 ` line is one file that moved, so it counts once like any other.
 *
 * @throws never — output this cannot read comes back as `NOTHING`, because a git that printed
 * something new is not a reason to fail a panel.
 */
export function parseGitPorcelain(stdout: string): GitCounts {
  let counts: GitCounts = NOTHING;
  for (const line of stdout.split('\n')) {
    counts = fold(counts, line.replace(/\r$/, ''));
  }
  return counts;
}

/** One reading, from a `GET /projects/status` body. @throws never. */
export function parseGitStatus(value: unknown): GitStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const branch = fields['branch'];
  const progress = GIT_PROGRESS_STATES.find((state) => state === fields['progress']);
  return {
    branch: typeof branch === 'string' ? branch.slice(0, MAX_BRANCH_CHARS) : undefined,
    ahead: count(fields['ahead']),
    behind: count(fields['behind']),
    dirty: count(fields['dirty']),
    conflicts: count(fields['conflicts']),
    progress,
  };
}

/** One line folded into the running counts. Anything unrecognised leaves them alone. */
function fold(counts: GitCounts, line: string): GitCounts {
  if (line.startsWith('# branch.head ')) {
    const name = line.slice('# branch.head '.length).trim();
    return { ...counts, branch: name === DETACHED || name === '' ? undefined : head(name) };
  }
  if (line.startsWith('# branch.ab ')) return { ...counts, ...divergence(line) };
  if (line.startsWith('1 ') || line.startsWith('2 ')) return { ...counts, dirty: counts.dirty + 1 };
  if (line.startsWith('u ')) return { ...counts, conflicts: counts.conflicts + 1 };
  return counts;
}

/** `# branch.ab +2 -1`. A token this cannot read counts as zero rather than losing the other one. */
function divergence(line: string): { readonly ahead: number; readonly behind: number } {
  let ahead = 0;
  let behind = 0;
  for (const token of line.slice('# branch.ab '.length).trim().split(/\s+/)) {
    if (token.startsWith('+')) ahead = whole(token.slice(1));
    if (token.startsWith('-')) behind = whole(token.slice(1));
  }
  return { ahead, behind };
}

function whole(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function head(name: string): string {
  return name.slice(0, MAX_BRANCH_CHARS);
}

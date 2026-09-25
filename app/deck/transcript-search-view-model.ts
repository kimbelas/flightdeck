// What the search panel says — P7-T2, SPEC §5.8, CODING-STANDARDS §3.
//
// **The sentence about the index comes first, and it is not decoration.** The cold backfill is
// about four and a half hours, once per machine (RESEARCH.md G.56), and migration 9 pays it again.
// During it a search that finds nothing is not evidence that nothing happened, so the panel says
// how much is still to read — in bytes, because the walk is newest first and the files still
// behind are the old, big ones — and an empty result says "yet".
//
// **A hit names a folder the owner recognises, when there is one.** The index stores Claude Code's
// slug (`C--Users-…-flightdeck`), which is lossy — every non-alphanumeric became `-` — so it cannot
// be turned back into a path. An imported project CAN be turned into a slug, so the match runs that
// way: a hit in an imported folder or one of its worktrees says the project's name; anything else
// says the slug with the drive and the account trimmed off the front.
//
// **Every string from a transcript is text** (SEC-UI-2): the snippet is drawn as a text node, never
// as markup, and the resume command is built from a uuid core already screened and a path the
// registry holds — never from anything in the snippet.
import type { ProjectRecord } from '../../contracts/project.ts';
import { isFilling } from '../../contracts/search-reply.ts';
import { transcriptSlug, worktreeSlugPrefix } from '../../contracts/search-filters.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ProseKind } from '../../contracts/transcript-prose.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import { agoLabel } from './ago.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { DateRange, SearchState } from './transcript-search-store.ts';

/** One hit, ready to draw. */
export interface SearchHitView {
  readonly key: string;
  readonly subscription: SubscriptionId;
  readonly project: string;
  readonly when: string;
  readonly said: string;
  readonly snippet: string;
  readonly shortId: string;
  /** What to paste into a terminal to go back to it. `cd` is included only when the folder is known. */
  readonly resume: string;
  /** The session as it is on the deck right now, when it is still there. */
  readonly row: SessionRowViewModel | undefined;
}

export interface SearchOption {
  readonly value: string;
  readonly label: string;
}

export const RANGE_OPTIONS: readonly { readonly value: DateRange; readonly label: string }[] = [
  { value: 'any', label: 'any time' },
  { value: 'day', label: 'last 24 h' },
  { value: 'week', label: 'last 7 days' },
  { value: 'month', label: 'last 30 days' },
  // The range the transcripts no longer cover — `cleanupPeriodDays` — and the index still does.
  { value: 'older', label: 'older than 30 days' },
];

const SAID: Readonly<Record<ProseKind, string>> = {
  you: 'you said',
  claude: 'Claude said',
  title: 'title',
  away: 'away summary',
};

/** The profile function that resumes a session on each account (DECISIONS.md D4). */
const RESUMER: Readonly<Record<SubscriptionId, string>> = {
  '365': 'claude-365',
  isg: 'claude-isg',
};

/** `C--Users-<account>-` — the front of every slug under a home folder. */
const HOME_PREFIX = /^[A-Za-z]--Users-[^-]+-/u;

export interface SearchSources {
  readonly state: SearchState;
  readonly projects: readonly ProjectRecord[];
  readonly rows: readonly SessionRowViewModel[];
  readonly now: number;
}

export class TranscriptSearchViewModel {
  private readonly sources: SearchSources;

  constructor(sources: SearchSources) {
    this.sources = sources;
  }

  /**
   * The index's state, as a sentence — or `undefined` once it has caught up.
   *
   * `undefined` progress is a core older than P7-T2, which is "unknown" and is said, because
   * silence would read as "caught up".
   */
  public get indexLine(): string | undefined {
    const progress = this.sources.state.index;
    if (progress === undefined) return 'index progress unknown — a missing hit may not be missing';
    if (progress.passedAt === undefined) {
      return 'the index is starting its first pass — results will be incomplete for a while';
    }
    if (!isFilling(progress)) return undefined;
    return `index still filling: ${bytes(progress.bytesIndexed)} of ${bytes(progress.bytesTotal)} read, ${String(progress.behind)} of ${String(progress.transcripts)} transcripts to go — older sessions may be missing`;
  }

  public get filling(): boolean {
    const progress = this.sources.state.index;
    return progress === undefined || isFilling(progress);
  }

  /** The line under the box: how many, how fast — or why there is nothing. */
  public get summary(): string | undefined {
    const { status, hits, tookMs, choice } = this.sources.state;
    if (choice.query.trim() === '') return undefined;
    if (status === 'failed') return 'search failed — is core running?';
    if (status === 'searching' && hits.length === 0) return 'searching…';
    if (hits.length === 0) return this.filling ? 'no session matches yet' : 'no session matches';
    const took = tookMs === undefined ? '' : ` · ${String(Math.round(tookMs))} ms`;
    return `${String(hits.length)} session${hits.length === 1 ? '' : 's'}${took}`;
  }

  public get hits(): readonly SearchHitView[] {
    return this.sources.state.hits.map((hit) => this.viewOf(hit));
  }

  /** The imported folders, by name, valued by the slug their transcripts are filed under. */
  public get projectOptions(): readonly SearchOption[] {
    return this.sources.projects.map((project) => ({
      value: transcriptSlug(project.path),
      label: project.name,
    }));
  }

  public get toolOptions(): readonly SearchOption[] {
    const { tools, choice } = this.sources.state;
    // A chosen tool stays listed even if a later read no longer offers it, so the select never
    // shows a value that is not one of its options.
    const all = choice.tool !== undefined && !tools.includes(choice.tool) ? [choice.tool, ...tools] : tools; // prettier-ignore
    return all.map((tool) => ({ value: tool, label: tool }));
  }

  public get filtered(): boolean {
    const { subscription, project, range, tool, session } = this.sources.state.choice;
    return [subscription, project, tool, session].some((value) => value !== undefined) || range !== 'any'; // prettier-ignore
  }

  private viewOf(hit: SearchHit): SearchHitView {
    const home = this.projectOf(hit.projectKey);
    const shortId = hit.sessionId.slice(0, 8);
    const resume = `${RESUMER[hit.subscription]} --resume ${hit.sessionId}`;
    return {
      key: `${hit.subscription}:${hit.sessionId}`,
      subscription: hit.subscription,
      project: home?.label ?? hit.projectKey.replace(HOME_PREFIX, ''),
      when: hit.at === 0 ? 'undated' : `${agoLabel(this.sources.now - hit.at)} ago`,
      said: SAID[hit.kind],
      snippet: hit.snippet,
      shortId,
      resume: home?.path === undefined ? resume : `cd "${home.path}"; ${resume}`,
      row: this.sources.rows.find(
        (row) => row.ref.sessionId === hit.sessionId && row.ref.subscription === hit.subscription,
      ),
    };
  }

  /**
   * The imported project a slug belongs to: its name, and its path when the slug IS the root.
   *
   * A worktree's path cannot be recovered from its slug (`-` stood for `\`, `.` and `-` alike),
   * so a worktree hit gets the name and the tree but no `cd`.
   */
  private projectOf(slug: string): { readonly label: string; readonly path?: string } | undefined {
    const wanted = slug.toLowerCase();
    for (const project of this.sources.projects) {
      const root = transcriptSlug(project.path).toLowerCase();
      if (wanted === root) return { label: project.name, path: project.path };
      const prefix = worktreeSlugPrefix(root);
      if (wanted.startsWith(prefix)) {
        return { label: `${project.name} · ${slug.slice(prefix.length)}` };
      }
    }
    return undefined;
  }
}

/** `23 MB`, `1.8 GB` — to the precision somebody reads a progress line at. */
function bytes(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)} GB`;
  if (count >= 1e6) return `${String(Math.round(count / 1e6))} MB`;
  return `${String(Math.round(count / 1e3))} KB`;
}

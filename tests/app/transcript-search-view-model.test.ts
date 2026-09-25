// What the search panel says, without React — P7-T2.
//
// Two decisions carry the task: the panel says out loud that the index is still filling (the
// backfill is hours, G.56), and a hit names a folder the owner recognises — through the imported
// project, since the slug cannot be turned back into a path.
import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { IndexProgress } from '../../contracts/search-reply.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import { SessionRowViewModel } from '../../app/deck/session-row-view-model.ts';
import { NO_CHOICE, type SearchState } from '../../app/deck/transcript-search-store.ts';
import { TranscriptSearchViewModel } from '../../app/deck/transcript-search-view-model.ts';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';

const PROJECT: ProjectRecord = {
  path: 'C:\\Users\\ada\\dev\\flightdeck',
  name: 'flightdeck',
  importedAt: 1,
};

const HIT: SearchHit = {
  subscription: '365',
  sessionId: SESSION,
  projectKey: 'C--Users-ada-dev-flightdeck',
  kind: 'you',
  at: NOW - 3 * DAY,
  snippet: 'deploy the worker to cloudflare',
};

const CAUGHT_UP: IndexProgress = {
  passedAt: NOW,
  transcripts: 1041,
  behind: 0,
  bytesTotal: 1_760_000_000,
  bytesIndexed: 1_760_000_000,
};

function state(over: Partial<SearchState> = {}): SearchState {
  return {
    choice: { ...NO_CHOICE, query: 'cloudflare' },
    status: 'done',
    hits: [HIT],
    index: CAUGHT_UP,
    tools: ['Bash'],
    tookMs: 12,
    ...over,
  };
}

function view(
  over: Partial<SearchState> = {},
  rows: readonly SessionRowViewModel[] = [],
): TranscriptSearchViewModel {
  return new TranscriptSearchViewModel({ state: state(over), projects: [PROJECT], rows, now: NOW });
}

describe('TranscriptSearchViewModel — the index', () => {
  it('says nothing once the index has caught up', () => {
    expect(view().indexLine).toBeUndefined();
    expect(view().filling).toBe(false);
  });

  it('says how much is left while it fills, in bytes and transcripts', () => {
    const filling = { ...CAUGHT_UP, behind: 900, bytesIndexed: 23_000_000 };

    expect(view({ index: filling }).indexLine).toBe(
      'index still filling: 23 MB of 1.8 GB read, 900 of 1041 transcripts to go — older sessions may be missing',
    );
  });

  it('says the first pass has not finished, which is not the same as caught up', () => {
    expect(view({ index: { ...CAUGHT_UP, passedAt: undefined } }).indexLine).toContain(
      'first pass',
    );
  });

  // A P7-T1 core sends no progress. Silence would read as "caught up".
  it('says it does not know, rather than nothing, when core sent no progress', () => {
    expect(view({ index: undefined }).indexLine).toContain('unknown');
  });
});

describe('TranscriptSearchViewModel — the summary', () => {
  it('says how many sessions and how fast', () => {
    expect(view().summary).toBe('1 session · 12 ms');
  });

  it('says "yet" for no hits while the index is filling', () => {
    const filling = { ...CAUGHT_UP, behind: 3 };

    expect(view({ hits: [], index: filling }).summary).toBe('no session matches yet');
    expect(view({ hits: [] }).summary).toBe('no session matches');
  });

  it('says nothing before anything is typed, and says so when core is down', () => {
    expect(view({ choice: NO_CHOICE }).summary).toBeUndefined();
    expect(view({ status: 'failed', hits: [] }).summary).toContain('failed');
  });
});

describe('TranscriptSearchViewModel — a hit', () => {
  it('names the imported project, the account, the age and who said it', () => {
    expect(view().hits[0]).toMatchObject({
      project: 'flightdeck',
      subscription: '365',
      when: '3d ago',
      said: 'you said',
      snippet: 'deploy the worker to cloudflare',
      shortId: 'aaaaaaaa',
    });
  });

  it('offers the command that goes back to it, in its own folder', () => {
    expect(view().hits[0]?.resume).toBe(
      `cd "C:\\Users\\ada\\dev\\flightdeck"; claude-365 --resume ${SESSION}`,
    );
  });

  // The worktree's own path cannot be recovered from the slug, so the `cd` is left out.
  it('names a worktree by its project and tree, with no cd it cannot know', () => {
    const tree = { ...HIT, projectKey: 'C--Users-ada-dev-flightdeck--claude-worktrees-p7-t2' };

    const hit = view({ hits: [tree] }).hits[0];

    expect(hit?.project).toBe('flightdeck · p7-t2');
    expect(hit?.resume).toBe(`claude-365 --resume ${SESSION}`);
  });

  it('names a folder nobody imported by its slug, without the drive and the account', () => {
    const elsewhere = { ...HIT, subscription: 'isg' as const, projectKey: 'C--Users-ada-dev-apex' };

    const hit = view({ hits: [elsewhere] }).hits[0];

    expect(hit?.project).toBe('dev-apex');
    expect(hit?.resume).toBe(`claude-isg --resume ${SESSION}`);
  });

  it('says undated for a line with no timestamp rather than "56 years ago"', () => {
    expect(view({ hits: [{ ...HIT, at: 0 }] }).hits[0]?.when).toBe('undated');
  });

  it('carries the live row when the session is still on the deck', () => {
    const row = new SessionRowViewModel(liveRow());

    expect(view({}, [row]).hits[0]?.row).toBe(row);
    expect(view({}, []).hits[0]?.row).toBeUndefined();
  });
});

describe('TranscriptSearchViewModel — the filters', () => {
  it('offers the imported projects by name, valued by their slug', () => {
    expect(view().projectOptions).toEqual([
      { value: 'C--Users-ada-dev-flightdeck', label: 'flightdeck' },
    ]);
  });

  it('keeps a chosen tool listed even when the list no longer has it', () => {
    const chosen = { ...NO_CHOICE, tool: 'WebFetch' };

    expect(view({ choice: chosen }).toolOptions.map((option) => option.value)).toEqual([
      'WebFetch',
      'Bash',
    ]);
  });

  it('knows whether anything is filtered, so "clear filters" is offered only then', () => {
    expect(view().filtered).toBe(false);
    expect(view({ choice: { ...NO_CHOICE, range: 'older' } }).filtered).toBe(true);
    expect(view({ choice: { ...NO_CHOICE, session: 'aaaaaaaa' } }).filtered).toBe(true);
  });
});

function liveRow(): SessionRow {
  return {
    sessionId: SESSION,
    shortId: 'aaaaaaaa',
    subscription: '365',
    kind: 'background',
    name: 'deploy',
    cwd: PROJECT.path,
    startedAt: 1,
    live: true,
    runState: 'working',
    status: 'busy',
    attachable: true,
    notAttachableBecause: undefined,
  };
}

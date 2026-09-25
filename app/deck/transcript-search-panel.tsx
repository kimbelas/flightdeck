'use client';

// Search every transcript — P7-T2, SPEC §5.8. *"Where did I do that Cloudflare Workers deploy?"*
//
// In the left column under Ask, and always there rather than behind a button: the box is the whole
// interface, and one that had to be opened first is a keystroke spent before the question. The
// palette's "Search every transcript" focuses it. Filters and results appear under it only once
// something is typed, so an idle panel costs the session list one line — plus the index sentence while the
// backfill runs (`TranscriptSearchViewModel.indexLine`), which is the point of drawing it at all.
//
// Everything this draws comes off `TranscriptSearchViewModel`; the store is `TranscriptSearchStore`,
// its own and not `DeckStore`'s (see that file for why).
import { useEffect, useMemo, useSyncExternalStore, type JSX } from 'react';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { ProjectRecord } from '../../contracts/project.ts';
import { BrowserDeckApi } from './browser-deck-api.ts';
import { TRANSCRIPT_SEARCH_ID } from './deck-keyboard.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import { SearchHits } from './transcript-search-hits.tsx';
import {
  DATE_RANGES,
  TranscriptSearchStore,
  type SearchChoice,
  type DateRange,
  type SearchClock,
} from './transcript-search-store.ts';
import {
  RANGE_OPTIONS,
  TranscriptSearchViewModel,
  type SearchOption,
} from './transcript-search-view-model.ts';

interface TranscriptSearchPanelProps {
  readonly projects: readonly ProjectRecord[];
  readonly rows: readonly SessionRowViewModel[];
  readonly now: number;
  readonly onOpenPane: (row: SessionRowViewModel) => void;
  readonly onResume: (row: SessionRowViewModel) => void;
}

export function TranscriptSearchPanel(props: TranscriptSearchPanelProps): JSX.Element {
  const store = useSearchStore();
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const view = new TranscriptSearchViewModel({ ...props, state });
  const choose = (changes: Partial<Omit<SearchChoice, 'query'>>): void => {
    void store.choose(changes);
  };
  return (
    <section className="transcript-search" aria-label="search transcripts">
      <input
        id={TRANSCRIPT_SEARCH_ID}
        className="search-box"
        type="search"
        value={state.choice.query}
        placeholder="search every transcript — cloudflare workers deploy"
        aria-label="search every transcript"
        onChange={(event) => {
          store.type(event.target.value);
        }}
      />
      {view.indexLine !== undefined && <p className="search-index">{view.indexLine}</p>}
      {/* Filters and hits only once there is a question: four selects on an idle panel pushed a
          crowded left column past its height, and the section overlapped the session rows. */}
      {state.choice.query.trim() !== '' && (
        <>
          <SearchFilters view={view} choice={state.choice} onChoose={choose} store={store} />
          {view.summary !== undefined && <p className="search-summary">{view.summary}</p>}
          <SearchHits
            hits={view.hits}
            onOnly={(shortId) => {
              choose({ session: shortId });
            }}
            onOpenPane={props.onOpenPane}
            onResume={props.onResume}
          />
        </>
      )}
    </section>
  );
}

interface SearchFiltersProps {
  readonly view: TranscriptSearchViewModel;
  readonly choice: SearchChoice;
  readonly onChoose: (changes: Partial<Omit<SearchChoice, 'query'>>) => void;
  readonly store: TranscriptSearchStore;
}

/** SPEC §5.8's five: subscription, project, date, tool — and session, set from a hit. */
function SearchFilters({ view, choice, onChoose, store }: SearchFiltersProps): JSX.Element {
  const accounts = SUBSCRIPTION_IDS.map((id) => ({ value: id, label: id }));
  return (
    <div className="search-filters">
      <FilterSelect
        name="subscription"
        any="any account"
        value={choice.subscription}
        options={accounts}
        onPick={(value) => {
          onChoose({ subscription: SUBSCRIPTION_IDS.find((id): id is SubscriptionId => id === value) }); // prettier-ignore
        }}
      />
      <FilterSelect
        name="project"
        any="any project"
        value={choice.project}
        options={view.projectOptions}
        onPick={(project) => {
          onChoose({ project });
        }}
      />
      <RangeSelect range={choice.range} onChoose={onChoose} />
      <FilterSelect
        name="tool"
        any="any tool"
        value={choice.tool}
        options={view.toolOptions}
        onPick={(tool) => {
          onChoose({ tool });
        }}
      />
      <FilterMarks view={view} choice={choice} store={store} />
    </div>
  );
}

/** The date filter. Never empty: "any time" is a range like the others. */
function RangeSelect({
  range,
  onChoose,
}: {
  readonly range: DateRange;
  readonly onChoose: (changes: Partial<Omit<SearchChoice, 'query'>>) => void;
}): JSX.Element {
  return (
    <select
      className="search-filter-range"
      aria-label="when"
      value={range}
      onChange={(event) => {
        onChoose({ range: DATE_RANGES.find((known) => known === event.target.value) ?? 'any' });
      }}
    >
      {RANGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** The session filter, which has no select — it is set from a hit — and the way back to none. */
function FilterMarks({ view, choice, store }: Omit<SearchFiltersProps, 'onChoose'>): JSX.Element {
  return (
    <>
      {choice.session !== undefined && (
        <span className="chip search-filter-session">session {choice.session}</span>
      )}
      {view.filtered && (
        <button
          type="button"
          className="ghost search-clear"
          onClick={() => {
            void store.clearFilters();
          }}
        >
          clear filters
        </button>
      )}
    </>
  );
}

interface FilterSelectProps {
  readonly name: string;
  readonly any: string;
  readonly value: string | undefined;
  readonly options: readonly SearchOption[];
  readonly onPick: (value: string | undefined) => void;
}

/** One filter as a select whose first option is "any" — the empty value, which is no filter. */
function FilterSelect({ name, any, value, options, onPick }: FilterSelectProps): JSX.Element {
  return (
    <select
      className={`search-filter-${name}`}
      aria-label={name}
      value={value ?? ''}
      onChange={(event) => {
        onPick(event.target.value === '' ? undefined : event.target.value);
      }}
    >
      <option value="">{any}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** The browser's clock and timer, for the store's typing pause. */
const BROWSER_CLOCK: SearchClock = {
  now: () => Date.now(),
  wait: (ms, task) => {
    const timer = setTimeout(task, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * One store for the life of the panel, opened once — the tool list and the index's progress.
 *
 * `useMemo` for identity, as `useDeckStore` does: a second store would be a second set of requests.
 */
function useSearchStore(): TranscriptSearchStore {
  const store = useMemo(() => new TranscriptSearchStore(new BrowserDeckApi(), BROWSER_CLOCK), []);
  useEffect(() => {
    void store.open();
  }, [store]);
  return store;
}

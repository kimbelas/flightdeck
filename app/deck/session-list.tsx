'use client';

// The left column: start a session, filter the list, then every session that survived the filter.
import type { JSX } from 'react';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import { SEARCH_INPUT_ID } from './deck-keyboard.ts';
import type { HandoffOffer } from './handoff-view-model.ts';
import { LaunchForm } from './launch-form.tsx';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';
import type { SessionPreviewViewModel } from './session-preview-view-model.ts';
import { SessionRowCard, type SessionRowCardProps } from './session-row-card.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

export interface SessionListProps {
  /** Already filtered — `search` is here only so the empty state can say which kind of empty. */
  readonly rows: readonly SessionRowViewModel[];
  readonly now: number;
  readonly loading: boolean;
  readonly coreUp: boolean;
  /** Both accounts' gauges, for the launch form's quota-aware picker (P4-T3). */
  readonly quota: QuotaSummary | undefined;
  readonly search: string;
  /** Which rows are open, by `SessionRowViewModel.key`. A set, because several can be. */
  readonly expanded: ReadonlySet<string>;
  /** The open rows' details, by the same key. A key with `undefined` is still in flight. */
  readonly details: Readonly<Record<string, SessionDetailViewModel | undefined>>;
  /**
   * The previews somebody pressed for, by the same key — P5a-T4.
   *
   * A key with `undefined` is a read in flight; a key ABSENT is nobody having pressed, which is
   * where every expanded row starts. That distinction is why this is a map and not a list.
   */
  readonly previews: Readonly<Record<string, SessionPreviewViewModel | undefined>>;
  /**
   * Where each row could be handed to, by the same key — P6-T6.
   *
   * Every row has one, unlike `previews`: an offer is a derivation over the worktrees the deck
   * already holds, not a read somebody pays for, and its `nothingBecause` is the answer for a row
   * with nowhere to go. A row missing from here is a row the caller forgot, which is why the
   * lookup below has no fallback to invent one.
   */
  readonly offers: Readonly<Record<string, HandoffOffer>>;
  /** The last refused handoff, as a sentence and the row it was about. `undefined` for silence. */
  readonly handoffRefusal: { readonly key: string; readonly text: string } | undefined;
  /** Which pane a session is in, 1-based, or `undefined` — P10-T1's "in pane N". */
  readonly paneOf: (key: string) => number | undefined;
  readonly onSearch: (value: string) => void;
  readonly onToggle: (row: SessionRowViewModel) => void;
  readonly onLaunch: (request: PresetLaunch) => void;
  readonly onOpen: (row: SessionRowViewModel) => void;
  readonly onResume: (row: SessionRowViewModel) => void;
  readonly onAdopt: (row: SessionRowViewModel) => void;
  readonly onStop: (row: SessionRowViewModel) => void;
  readonly onRemove: (row: SessionRowViewModel) => void;
  readonly onPreview: (row: SessionRowViewModel) => void;
  readonly onHandOff: (row: SessionRowViewModel, path: string, name: string) => Promise<boolean>;
}

/**
 * The offer for a row nobody computed one for.
 *
 * It cannot happen through `DeckBody`, which builds one per row from the same list, and it is the
 * right answer if it ever did: an offer is what this row can be handed to, and "we did not work it
 * out" is nowhere, not everywhere.
 */
const NOWHERE: HandoffOffer = {
  targets: [],
  nothingBecause: 'Nothing is known about this session’s worktrees.',
  suggestedName: '',
};

export function SessionList(props: SessionListProps): JSX.Element {
  return (
    <section className="rows" aria-label="sessions">
      <LaunchForm
        disabled={!props.coreUp || props.loading}
        quota={props.quota}
        now={props.now}
        onLaunch={props.onLaunch}
      />
      <SessionSearch search={props.search} onSearch={props.onSearch} />
      {props.rows.length === 0 && !props.loading && <EmptyRows search={props.search} />}
      <SessionRows {...props} />
    </section>
  );
}

/**
 * Every row that survived the filter.
 *
 * Split from `SessionList` when the launch form grew its quota props, and it is the right seam
 * regardless: the section above it is four controls that do not change when a session does.
 */
function SessionRows(props: SessionListProps): JSX.Element {
  return (
    <>
      {props.rows.map((row) => (
        <BoundRow key={row.key} row={row} list={props} />
      ))}
    </>
  );
}

/**
 * One row, and every callback bound to it.
 *
 * Split from the map above because the card takes fourteen props and the list has a line limit,
 * and the seam is honest: `SessionRows` decides WHICH rows are drawn and this decides what each
 * one is given. Nothing is memoised — the whole list re-renders on a stream frame anyway, which
 * is P2-T4's shape and what keeps the row a pure function of its view model.
 */
export function BoundRow({
  row,
  list,
}: {
  readonly row: SessionRowViewModel;
  readonly list: SessionListProps;
}): JSX.Element {
  return (
    <SessionRowCard
      row={row}
      now={list.now}
      expanded={list.expanded.has(row.key)}
      detail={list.details[row.key]}
      preview={list.previews[row.key]}
      previewAsked={row.key in list.previews}
      handoff={list.offers[row.key] ?? NOWHERE}
      handoffRefusal={refusalFor(list.handoffRefusal, row.key)}
      inPane={list.paneOf(row.key)}
      {...handlersFor(row, list)}
    />
  );
}

/**
 * Every callback the card takes, bound to one row.
 *
 * Lifted out of the element for the list's line limit, and it reads better for it: the element
 * above is now what the row IS, and this is what pressing anything on it does. The list's own
 * callbacks all take the row, so binding is the whole of the work.
 */
function handlersFor(
  row: SessionRowViewModel,
  list: SessionListProps,
): Pick<
  SessionRowCardProps,
  'onHandOff' | 'onToggle' | 'onResume' | 'onAdopt' | 'onStop' | 'onRemove' | 'onOpen' | 'onPreview'
> {
  return {
    onHandOff: (path, name) => list.onHandOff(row, path, name),
    onToggle: () => {
      list.onToggle(row);
    },
    onResume: () => {
      list.onResume(row);
    },
    onAdopt: () => {
      list.onAdopt(row);
    },
    onStop: () => {
      list.onStop(row);
    },
    onRemove: () => {
      list.onRemove(row);
    },
    onOpen: () => {
      list.onOpen(row);
    },
    onPreview: () => {
      list.onPreview(row);
    },
  };
}

/**
 * The refusal sentence for one row, and `undefined` for every other row.
 *
 * Several rows can be open at once (P2-T4), and a code with no row on it would put "that folder is
 * gone" under a session nobody pressed — a sentence that is false about that row (`HandoffSlice`).
 */
function refusalFor(refusal: SessionListProps['handoffRefusal'], key: string): string | undefined {
  return refusal?.key === key ? refusal.text : undefined;
}

interface SessionSearchProps {
  readonly search: string;
  readonly onSearch: (value: string) => void;
}

/**
 * The `/` box — P2-T5.
 *
 * It is a plain visible input rather than something `/` conjures into existence. Two reasons: a
 * filter that is on has to be visible or it becomes the reason sessions are "missing", and the
 * keyboard's job here is to put focus in a control, not to create one. The id is how it does that
 * (deck-keyboard.ts); the hint on the right is the only place the deck advertises a key.
 */
export function SessionSearch({ search, onSearch }: SessionSearchProps): JSX.Element {
  return (
    <div className="search">
      <input
        id={SEARCH_INPUT_ID}
        className="search-input"
        value={search}
        placeholder="filter sessions"
        aria-label="filter sessions"
        onChange={(event) => {
          onSearch(event.target.value);
        }}
      />
      <kbd className="search-key" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}

/** "There are none" and "your filter hid them all" are different problems with different fixes. */
function EmptyRows({ search }: { readonly search: string }): JSX.Element {
  if (search !== '') {
    return (
      <p className="muted pad">No session matches “{search}”. Clear the box to see them all.</p>
    );
  }
  return <p className="muted pad">No sessions. Start one above and it becomes a pane.</p>;
}

'use client';

// The left column: start a session, filter the list, then every session that survived the filter.
import type { JSX } from 'react';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import { SEARCH_INPUT_ID } from './deck-keyboard.ts';
import { LaunchForm } from './launch-form.tsx';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';
import type { SessionPreviewViewModel } from './session-preview-view-model.ts';
import { SessionRowCard } from './session-row-card.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface SessionListProps {
  /** Already filtered — `search` is here only so the empty state can say which kind of empty. */
  readonly rows: readonly SessionRowViewModel[];
  readonly now: number;
  readonly loading: boolean;
  readonly coreUp: boolean;
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
  readonly onSearch: (value: string) => void;
  readonly onToggle: (row: SessionRowViewModel) => void;
  readonly onLaunch: (request: PresetLaunch) => void;
  readonly onOpen: (row: SessionRowViewModel) => void;
  readonly onResume: (row: SessionRowViewModel) => void;
  readonly onStop: (row: SessionRowViewModel) => void;
  readonly onRemove: (row: SessionRowViewModel) => void;
  readonly onPreview: (row: SessionRowViewModel) => void;
}

export function SessionList(props: SessionListProps): JSX.Element {
  const { rows, now, expanded, details, previews, onToggle, onOpen, onResume, onStop } = props;
  return (
    <section className="rows" aria-label="sessions">
      <LaunchForm disabled={!props.coreUp || props.loading} onLaunch={props.onLaunch} />
      <SessionSearch search={props.search} onSearch={props.onSearch} />
      {rows.length === 0 && !props.loading && <EmptyRows search={props.search} />}
      {rows.map((row) => (
        <SessionRowCard
          key={row.key}
          row={row}
          now={now}
          expanded={expanded.has(row.key)}
          detail={details[row.key]}
          preview={previews[row.key]}
          previewAsked={row.key in previews}
          onToggle={() => {
            onToggle(row);
          }}
          onResume={() => {
            onResume(row);
          }}
          onStop={() => {
            onStop(row);
          }}
          onRemove={() => {
            props.onRemove(row);
          }}
          onOpen={() => {
            onOpen(row);
          }}
          onPreview={() => {
            props.onPreview(row);
          }}
        />
      ))}
    </section>
  );
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
function SessionSearch({ search, onSearch }: SessionSearchProps): JSX.Element {
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

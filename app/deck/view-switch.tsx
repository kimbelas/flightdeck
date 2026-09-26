'use client';

// The header's State board controls — P10-T1: which view, what the board is grouped by, and what
// this week cost.
//
// Out of `deck-header.tsx` for its line limit, and the seam is real: the header's older half is the
// machine (core, quota, the version chip) and this half is how the deck is looking at it.
import type { JSX } from 'react';
import {
  DECK_VIEWS,
  isBuiltView,
  VIEW_LABELS,
  type DeckViewMode,
} from '../../contracts/deck-view.ts';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { SpendHeld } from './spend-slice.ts';
import { SpendViewModel } from './spend-view-model.ts';

/** What the header needs to switch views and say what the board is showing — P10-T1. */
export interface HeaderBoard {
  readonly view: DeckViewMode;
  readonly onView: (view: DeckViewMode) => void;
  readonly spend: SpendHeld;
  readonly projects: readonly ProjectRecord[];
  readonly onReadSpend: () => void;
  /** Unfolds the rail and puts the caret in the launch prompt — there is one launch form. */
  readonly onNewSession: () => void;
}

/** The switch. The line saying what the board is grouped by is on the board's own toolbar. */
export function BoardHeading({ board }: { readonly board: HeaderBoard }): JSX.Element {
  return <ViewSwitch view={board.view} onView={board.onView} />;
}

/** This week's spend and New session, after the quota blocks. */
export function BoardActions({
  board,
  coreUp,
}: {
  readonly board: HeaderBoard;
  readonly coreUp: boolean;
}): JSX.Element {
  return (
    <>
      <WeekSpend
        spend={board.spend}
        projects={board.projects}
        disabled={!coreUp}
        onRead={board.onReadSpend}
      />
      <button type="button" className="new-session" data-new-session onClick={board.onNewSession}>
        New session
      </button>
    </>
  );
}

interface ViewSwitchProps {
  readonly view: DeckViewMode;
  readonly onView: (view: DeckViewMode) => void;
}

/**
 * Board / Panes / Table.
 *
 * Table is on it and disabled, with a title saying so, rather than missing: it is where the switch
 * is going, and a button that drew nothing when pressed would be one that looks broken.
 */
function ViewSwitch({ view, onView }: ViewSwitchProps): JSX.Element {
  return (
    <div className="view-switch" role="group" aria-label="view">
      {DECK_VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          className={option === view ? 'is-on' : undefined}
          aria-pressed={option === view}
          data-deck-view-option={option}
          disabled={!isBuiltView(option)}
          title={isBuiltView(option) ? undefined : 'Not built yet'}
          onClick={() => {
            onView(option);
          }}
        >
          {VIEW_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * What the board is showing, as a sentence — the mockup's "Group by state · …".
 *
 * Both accounts, always: there is no account filter, and a line that named one would be claiming a
 * narrowing that is not happening.
 */
export function GroupLine({ project }: { readonly project: string | undefined }): JSX.Element {
  return (
    <span className="group-line muted" data-board-group-line>
      Group by <b>state</b> · {project ?? 'all projects'} · both accounts
    </span>
  );
}

interface WeekSpendProps {
  readonly spend: SpendHeld;
  readonly projects: readonly ProjectRecord[];
  readonly disabled: boolean;
  readonly onRead: () => void;
}

/**
 * This week's spend, both accounts — P7-T3's summary, read on press.
 *
 * A button and not a figure, because the summary is only ever read when somebody asks (the spend
 * panel's rule, and a smoke check pins it): the header shows `this week` until pressed, then the
 * number, and pressing again re-reads it. It shares the panel's slice, so opening either fills both.
 */
function WeekSpend({ spend, projects, disabled, onRead }: WeekSpendProps): JSX.Element {
  const figure =
    spend.summary === undefined ? undefined : new SpendViewModel(spend.summary, projects).thisWeek;
  return (
    <button
      type="button"
      className="ghost week-spend"
      data-week-spend
      disabled={disabled || spend.reading}
      title="Cost of the runs that ended this week, both accounts. Press to read it again."
      onClick={onRead}
    >
      {spend.reading ? 'reading…' : figure === undefined ? 'this week' : `${figure} this week`}
    </button>
  );
}

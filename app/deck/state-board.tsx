'use client';

// The State board — P10-T1, mockup 06. Five columns by state; the panes are docked underneath.
//
// A session card here IS the list's card (`BoundRow` → `SessionRowCard`), so expanding one, its
// lifecycle buttons, `data-deck-row` for j/k and the palette's "jump to" all behave as they do in the
// Panes view. Only one of the two views draws cards at a time, so a key never matches two of them.
// Which column a card is in and what "Show N more" holds back are `StateBoardViewModel`'s.
import { useState, type JSX } from 'react';
import { focusPane } from './deck-keyboard.ts';
import { CardModal } from './card-modal.tsx';
import { BoundRow, SessionSearch, type SessionListProps } from './session-list.tsx';
import {
  StateBoardViewModel,
  type BoardColumn,
  type BoardColumnId,
  type ShellCardModel,
} from './state-board-view-model.ts';
import type { OpenPane } from './open-pane.ts';
import { GroupLine } from './view-switch.tsx';

interface StateBoardProps {
  /** The list's props, whole — the cards take exactly what the list's rows take. */
  readonly list: SessionListProps;
  readonly panes: readonly OpenPane[];
  /** The current project's name, or `undefined` for all of them. */
  readonly project: string | undefined;
  readonly onOpenShell: () => void;
}

export function StateBoard({ list, panes, project, onOpenShell }: StateBoardProps): JSX.Element {
  const [revealed, setRevealed] = useState<ReadonlySet<BoardColumnId>>(() => new Set());
  const board = new StateBoardViewModel(list.rows, panes, revealed);
  const open = openRow(list);
  const reveal = (id: BoardColumnId): void => {
    setRevealed((current) => new Set([...current, id]));
  };
  return (
    <section className="board" aria-label="sessions by state">
      <div className="board-tools">
        <GroupLine project={project} />
        <SessionSearch search={list.search} onSearch={list.onSearch} />
      </div>
      <div className="board-columns">
        {board.columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            list={list}
            onReveal={reveal}
            onOpenShell={onOpenShell}
          />
        ))}
      </div>
      {open !== undefined && <CardModal key={open.key} row={open} list={list} />}
    </section>
  );
}

/**
 * The card the modal shows: the most recently opened one still on the board.
 *
 * Expansion is a set because the list can hold several open rows (P2-T4); the board draws one at a
 * time, and the newest is the one just pressed. A card hidden behind "Show N more" still counts —
 * the palette's "jump to" can open one.
 */
function openRow(list: SessionListProps): SessionListProps['rows'][number] | undefined {
  const open = [...list.expanded].reverse();
  for (const key of open) {
    const row = list.rows.find((each) => each.key === key);
    if (row !== undefined) return row;
  }
  return undefined;
}

interface BoardColumnViewProps {
  readonly column: BoardColumn;
  readonly list: SessionListProps;
  readonly onReveal: (id: BoardColumnId) => void;
  readonly onOpenShell: () => void;
}

function BoardColumnView({
  column,
  list,
  onReveal,
  onOpenShell,
}: BoardColumnViewProps): JSX.Element {
  return (
    <section
      className={`board-col board-col-${column.id}${column.muted ? ' is-muted' : ''}`}
      data-board-column={column.id}
      aria-label={column.label}
    >
      <header className="board-col-head">
        <span className="board-dot" aria-hidden="true" />
        {column.label}
        <span className="board-col-count" data-board-count>
          {column.count}
        </span>
      </header>
      <div className="board-col-cards">
        {column.rows.map((row) => (
          <BoundRow key={row.key} row={row} list={list} />
        ))}
        {column.shells.map((shell) => (
          <ShellCard key={shell.key} shell={shell} />
        ))}
        <ColumnFoot column={column} onReveal={onReveal} onOpenShell={onOpenShell} />
      </div>
    </section>
  );
}

/** "Show N more" on a capped column, `+ shell` under the shells, and nothing anywhere else. */
function ColumnFoot({
  column,
  onReveal,
  onOpenShell,
}: Omit<BoardColumnViewProps, 'list'>): JSX.Element | null {
  if (column.id === 'shells') {
    return (
      <button
        type="button"
        className="ghost board-more"
        data-board-shell-open
        onClick={onOpenShell}
      >
        + shell
      </button>
    );
  }
  if (column.hidden === 0) return null;
  return (
    <button
      type="button"
      className="ghost board-more"
      data-board-more
      onClick={() => {
        onReveal(column.id);
      }}
    >
      Show {column.hidden} more
    </button>
  );
}

/**
 * One shell. It is always in a pane — a shell is nothing else (`shell-pane.ts`) — so its one verb
 * is to put the caret there, which is what its digit key does too.
 */
function ShellCard({ shell }: { readonly shell: ShellCardModel }): JSX.Element {
  return (
    <article className="row shell-card" data-board-shell={shell.key}>
      <div className="row-main">
        <span className="row-title">{shell.title}</span>
        <span className="tag tag-pane" data-row-in-pane={shell.pane}>
          in pane {shell.pane}
        </span>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            focusPane(shell.pane);
          }}
        >
          focus
        </button>
      </div>
    </article>
  );
}

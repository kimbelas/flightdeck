'use client';

// The deck's body — the rail on the left, and the board or the grid beside it (P5a-T5, P10-T1).
//
// Out of `deck-view.tsx` for its 250-line limit, and the seam is a real one: `DeckView` composes
// and holds state, and this arranges. Nothing here fetches and nothing here decides.
//
// **The grid is at the same place in the tree in both views**, with the same key: the board is the
// slot BEFORE it, present or not, and the Board view docks the grid by a class (`dock`). Moving the
// grid into another container for the dock would remount every pane, and a remount closes its
// socket (`pane-grid.tsx`). `data-pane-mount` is how the smoke proves it did not happen.
import { useState, type JSX } from 'react';
import type { DeckActions } from './deck-commands.ts';
import { sessionKey } from '../../contracts/session-row.ts';
import { projectKey } from '../../contracts/project.ts';
import type { DeckState } from './deck-store.ts';
import { DeckRail } from './deck-rail.tsx';
import { PaneGrid } from './pane-grid.tsx';
import { SessionDetailViewModel } from './session-detail-view-model.ts';
import { handoffOffer, handoffRefusalLine, type HandoffOffer } from './handoff-view-model.ts';
import type { SessionListProps } from './session-list.tsx';
import { SessionPreviewViewModel } from './session-preview-view-model.ts';
import { StateBoard } from './state-board.tsx';
import { StateBoardViewModel } from './state-board-view-model.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { ProjectScope } from './project-scope.ts';
import type { CurrentProject } from './use-current-project.ts';
import type { DeckView } from './use-deck-view.ts';
import type { PaneGridState } from './use-pane-grid.ts';

export interface DeckBodyProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly grid: PaneGridState;
  /** Which project each session is in — P3-T6. Built in `DeckView` so one object answers both. */
  readonly scope: ProjectScope;
  readonly project: CurrentProject;
  readonly expanded: ReadonlySet<string>;
  readonly actions: DeckActions;
  readonly onToggle: (row: SessionRowViewModel) => void;
  readonly deckView: DeckView;
}

export function DeckBody(props: DeckBodyProps): JSX.Element {
  const { rows, state, now, grid, scope, project, actions, deckView } = props;
  // `/`'s filter is a fact about the cards, whichever view draws them; the header still counts
  // every session and the palette still reaches every session (P2-T5).
  const [search, setSearch] = useState('');
  const list = listProps(props, search, setSearch);
  const { view } = deckView;
  return (
    <div className={`deck-body view-${view}${deckView.railFolded ? ' rail-folded' : ''}`}>
      <DeckRail
        view={view}
        folded={deckView.railFolded}
        onFold={deckView.setRailFolded}
        list={list}
        everyRow={rows}
        state={state}
        now={now}
        scope={scope}
        project={project}
        actions={actions}
      />
      <div className="deck-main">
        {view === 'board' ? (
          <StateBoard
            key="board"
            list={list}
            panes={grid.panes}
            project={projectName(state, project.key)}
            onOpenShell={actions.onOpenShell}
          />
        ) : null}
        <DeckPanes key="panes" dock={view === 'board'} {...props} />
      </div>
    </div>
  );
}

/** The grid, docked under the board or given the screen — one element either way. */
function DeckPanes(props: DeckBodyProps & { readonly dock: boolean }): JSX.Element {
  const { rows, state, grid, actions } = props;
  return (
    <PaneGrid
      dock={props.dock}
      panes={grid.panes}
      rows={rows}
      layout={grid.layout}
      focusedKey={grid.focusedKey}
      onLayout={grid.setLayout}
      onFocused={grid.setFocused}
      onRename={grid.renamePane}
      onStop={actions.onStop}
      onPopOut={actions.onPopOut}
      muted={state.muted}
      onMute={actions.onMute}
      onRespawn={actions.onRespawnOne}
      onClose={grid.closePane}
      onOpenPane={actions.onOpenPane}
    />
  );
}

/** The current project's name, for the board's "Group by state · …" line. */
function projectName(state: DeckState, key: string | undefined): string | undefined {
  return state.projects.find((record) => projectKey(record.path) === key)?.name;
}

/**
 * What the cards are given, in either view — the list's props, built once.
 *
 * P3-T6: the current project narrows the CARDS and nothing else. Matched by KEY rather than by
 * re-deriving from the view model: `ProjectScope` answers about `SessionRow`, which is what carries
 * a `cwd`, and a second path rule on the presentation side would be a second opinion.
 */
function listProps(
  props: DeckBodyProps,
  search: string,
  onSearch: (value: string) => void,
): SessionListProps {
  const { rows, state, now, scope, project, actions } = props;
  const keep = new Set(scope.rowsIn(project.key, state.rows).map(sessionKey));
  const inProject = rows.filter((row) => keep.has(row.key));
  const board = new StateBoardViewModel([], props.grid.panes);
  return {
    rows: inProject.filter((row) => row.matches(search)),
    now,
    loading: state.loading,
    coreUp: state.coreUp,
    quota: state.quota,
    search,
    expanded: props.expanded,
    details: detailViewModels(state.details),
    previews: previewViewModels(state.previews),
    offers: handoffOffers(inProject, scope, state.maps),
    handoffRefusal: handoffRefusalFor(state.handoffRefusal),
    paneOf: (key) => board.paneNumber(key),
    detailInline: props.deckView.view !== 'board',
    onSearch,
    onToggle: props.onToggle,
    onLaunch: actions.onLaunch,
    onOpen: actions.onOpenPane,
    onResume: actions.onResume,
    onAdopt: actions.onAdopt,
    onStop: actions.onStop,
    onRemove: actions.onRemove,
    onPreview: actions.onPreview,
    onHandOff: actions.onHandOff,
  };
}

/** The last refused handoff as a sentence, still carrying the row it was about — P6-T6. */
function handoffRefusalFor(
  refusal: DeckState['handoffRefusal'],
): { readonly key: string; readonly text: string } | undefined {
  if (refusal === undefined) return undefined;
  return { key: refusal.key, text: handoffRefusalLine(refusal.code) };
}

/**
 * Where each row on screen could be handed to — P6-T6.
 *
 * Built here rather than in the store for `detailViewModels`' reason: the store holds wire values
 * and this is presentation (CODING-STANDARDS §3). It is also the only place with both halves —
 * `ProjectScope` says which project a session is in, and the maps carry that project's worktrees.
 *
 * **The three states of `maps[key]` are kept apart**, which is why this is not one `??`. A row in
 * no imported project gets `undefined`, and a row in one whose map has not arrived gets an empty
 * list; `handoffOffer` says a different sentence for each, and collapsing them would tell somebody
 * to import a folder they imported an hour ago.
 */
function handoffOffers(
  rows: readonly SessionRowViewModel[],
  scope: ProjectScope,
  maps: DeckState['maps'],
): Readonly<Record<string, HandoffOffer>> {
  return Object.fromEntries(
    rows.map((row) => {
      const cwd = row.cwd ?? '';
      const key = cwd === '' ? undefined : scope.keyFor(cwd);
      const worktrees = key === undefined ? undefined : (maps[key]?.worktrees ?? []);
      return [row.key, handoffOffer(worktrees, cwd, row.title)];
    }),
  );
}

/**
 * The open rows' details, as view models.
 *
 * Wrapped here rather than in the store, which holds wire values: a view model is presentation and
 * the store is state (CODING-STANDARDS §3). `undefined` survives the mapping and is what draws the
 * spinner — a key present with no value means "asked, still waiting".
 */
function detailViewModels(
  details: DeckState['details'],
): Readonly<Record<string, SessionDetailViewModel | undefined>> {
  return Object.fromEntries(
    Object.entries(details).map(([key, detail]) => [
      key,
      detail === undefined ? undefined : new SessionDetailViewModel(detail),
    ]),
  );
}

/**
 * The previews that were pressed for, as view models — P5a-T4.
 *
 * `detailViewModels`'s twin, and the mapping has to preserve an ABSENT key rather than filling it
 * with `undefined`: absent means nobody pressed and draws the button alone, while present-and-
 * `undefined` means a read is in flight and draws the spinner.
 */
function previewViewModels(
  previews: DeckState['previews'],
): Readonly<Record<string, SessionPreviewViewModel | undefined>> {
  return Object.fromEntries(
    Object.entries(previews).map(([key, preview]) => [
      key,
      preview === undefined ? undefined : new SessionPreviewViewModel(preview),
    ]),
  );
}

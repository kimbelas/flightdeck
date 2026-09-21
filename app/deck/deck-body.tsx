'use client';

// The deck's two columns — the list on the left, the panes on the right (P5a-T5).
//
// Out of `deck-view.tsx` for its 250-line limit, and the seam is a real one: `DeckView` composes
// and holds state, and this arranges. Nothing here fetches and nothing here decides.
import { useState, type JSX } from 'react';
import type { DeckActions } from './deck-commands.ts';
import type { DeckState } from './deck-store.ts';
import { PaneGrid } from './pane-grid.tsx';
import { ProjectsPanel } from './projects-panel.tsx';
import { ProjectsViewModel } from './projects-view-model.ts';
import { SessionDetailViewModel } from './session-detail-view-model.ts';
import { SessionList } from './session-list.tsx';
import { SessionPreviewViewModel } from './session-preview-view-model.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { PaneGridState } from './use-pane-grid.ts';

export interface DeckBodyProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly grid: PaneGridState;
  readonly expanded: ReadonlySet<string>;
  readonly actions: DeckActions;
  readonly onToggle: (row: SessionRowViewModel) => void;
}

/**
 * The two columns, and the one piece of state that belongs to them rather than to the deck.
 *
 * `/`'s filter lives here because it is a fact about the list — the header still counts every
 * session and the palette still reaches every session, and neither has to know a box is filled in.
 * The keyboard does not know either: `/` focuses this box by id (deck-keyboard.ts), which is why
 * nothing above had to thread the query down or a setter back up.
 */
export function DeckBody({
  rows,
  state,
  now,
  grid,
  expanded,
  actions,
  onToggle,
}: DeckBodyProps): JSX.Element {
  return (
    <div className="deck-body">
      <DeckLeft
        rows={rows}
        state={state}
        now={now}
        expanded={expanded}
        actions={actions}
        onToggle={onToggle}
      />
      <PaneGrid
        panes={grid.panes}
        layout={grid.layout}
        focusedKey={grid.focusedKey}
        onLayout={grid.setLayout}
        onFocused={grid.setFocused}
        onClose={grid.closePane}
      />
    </div>
  );
}

interface DeckLeftProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly expanded: ReadonlySet<string>;
  readonly actions: DeckActions;
  readonly onToggle: (row: SessionRowViewModel) => void;
}

/** The projects panel and the session list, and the `/` filter that belongs to the list. */
function DeckLeft({ rows, state, now, expanded, actions, onToggle }: DeckLeftProps): JSX.Element {
  const [search, setSearch] = useState('');
  return (
    <div className="deck-left">
      <DeckProjects state={state} actions={actions} />
      <SessionList
        rows={rows.filter((row) => row.matches(search))}
        now={now}
        loading={state.loading}
        coreUp={state.coreUp}
        search={search}
        expanded={expanded}
        details={detailViewModels(state.details)}
        previews={previewViewModels(state.previews)}
        onSearch={setSearch}
        onToggle={onToggle}
        onLaunch={actions.onLaunch}
        onOpen={actions.onOpenPane}
        onResume={actions.onResume}
        onStop={actions.onStop}
        onRemove={actions.onRemove}
        onPreview={actions.onPreview}
      />
    </div>
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

/**
 * The projects panel and everything it draws from — split out for `DeckLeft`'s line count.
 *
 * The view model is built here rather than in the store, which holds wire values: a view model is
 * presentation and the store is state (CODING-STANDARDS §3).
 */
function DeckProjects({
  state,
  actions,
}: {
  readonly state: DeckState;
  readonly actions: DeckActions;
}): JSX.Element {
  return (
    <ProjectsPanel
      model={
        new ProjectsViewModel({
          projects: state.projects,
          refusal: state.importRefusal,
          statuses: state.statuses,
          maps: state.maps,
          presets: state.presets,
          presetRefusal: state.presetRefusal,
        })
      }
      disabled={!state.coreUp}
      onImport={actions.onImportProject}
      onForget={actions.onForgetProject}
      presets={actions}
    />
  );
}

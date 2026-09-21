'use client';

// The deck's two columns — the list on the left, the panes on the right (P5a-T5).
//
// Out of `deck-view.tsx` for its 250-line limit, and the seam is a real one: `DeckView` composes
// and holds state, and this arranges. Nothing here fetches and nothing here decides.
import { useState, type JSX } from 'react';
import type { DeckActions } from './deck-commands.ts';
import { sessionKey } from '../../contracts/session-row.ts';
import type { DeckState } from './deck-store.ts';
import { PaneGrid } from './pane-grid.tsx';
import { ProjectsPanel } from './projects-panel.tsx';
import { ProjectsViewModel } from './projects-view-model.ts';
import { SessionDetailViewModel } from './session-detail-view-model.ts';
import { AskPanel } from './ask-panel.tsx';
import { handoffOffer, handoffRefusalLine, type HandoffOffer } from './handoff-view-model.ts';
import { SessionList } from './session-list.tsx';
import { SessionPreviewViewModel } from './session-preview-view-model.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { ProjectScope } from './project-scope.ts';
import type { CurrentProject } from './use-current-project.ts';
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
}

/** The two columns. What each of them draws is a child's business — see `DeckSessions`. */
export function DeckBody(props: DeckBodyProps): JSX.Element {
  const { rows, state, now, grid, scope, project, expanded, actions, onToggle } = props;
  // P3-T6. The current project narrows the LIST and nothing else: the header still counts every
  // session, the palette still reaches every session, and the panes on the right are whatever was
  // open. The same shape `/`’s filter already has.
  // Matched by KEY rather than by re-deriving from the view model: `ProjectScope` answers about
  // `SessionRow`, which is what carries a `cwd`, and a second path rule on the presentation side
  // would be a second opinion about which project a session is in.
  const keep = new Set(scope.rowsIn(project.key, state.rows).map(sessionKey));
  const inProject = rows.filter((row) => keep.has(row.key));
  return (
    <div className="deck-body">
      <DeckLeft
        rows={inProject}
        state={state}
        now={now}
        scope={scope}
        project={project}
        expanded={expanded}
        actions={actions}
        onToggle={onToggle}
      />
      <PaneGrid
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
      />
    </div>
  );
}

interface DeckLeftProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly scope: ProjectScope;
  readonly project: CurrentProject;
  readonly expanded: ReadonlySet<string>;
  readonly actions: DeckActions;
  readonly onToggle: (row: SessionRowViewModel) => void;
}

/** The projects panel, the Ask box and the session list. */
function DeckLeft(props: DeckLeftProps): JSX.Element {
  const { state, now, actions } = props;
  return (
    <div className="deck-left">
      <DeckProjects state={state} actions={actions} scope={props.scope} project={props.project} />
      {/* P4-T4. Above the session list: a question is a thing you START, like a launch, and the
          answer belongs beside the sessions rather than inside one of them. */}
      <AskPanel
        run={state.ask}
        refusal={state.askRefusal}
        quota={state.quota}
        now={now}
        disabled={!state.coreUp}
        onAsk={actions.onAsk}
        onClear={actions.onClearAsk}
      />
      <DeckSessions {...props} />
    </div>
  );
}

/**
 * The list, and the one piece of state that belongs to it rather than to the deck.
 *
 * `/`'s filter lives here because it is a fact about the list — the header still counts every
 * session and the palette still reaches every session, and neither has to know a box is filled in.
 * The keyboard does not know either: `/` focuses this box by id (deck-keyboard.ts), which is why
 * nothing above had to thread the query down or a setter back up.
 */
function DeckSessions(props: DeckLeftProps): JSX.Element {
  const { rows, state, now, expanded, actions, onToggle } = props;
  const [search, setSearch] = useState('');
  return (
    <SessionList
      rows={rows.filter((row) => row.matches(search))}
      now={now}
      loading={state.loading}
      coreUp={state.coreUp}
      quota={state.quota}
      search={search}
      expanded={expanded}
      details={detailViewModels(state.details)}
      previews={previewViewModels(state.previews)}
      offers={handoffOffers(rows, props.scope, state.maps)}
      handoffRefusal={handoffRefusalFor(state.handoffRefusal)}
      onSearch={setSearch}
      onToggle={onToggle}
      onLaunch={actions.onLaunch}
      onOpen={actions.onOpenPane}
      onResume={actions.onResume}
      onStop={actions.onStop}
      onRemove={actions.onRemove}
      onPreview={actions.onPreview}
      onHandOff={actions.onHandOff}
    />
  );
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

/**
 * The projects panel and everything it draws from — split out for `DeckLeft`'s line count.
 *
 * The view model is built here rather than in the store, which holds wire values: a view model is
 * presentation and the store is state (CODING-STANDARDS §3).
 */
function DeckProjects({
  state,
  actions,
  scope,
  project,
}: {
  readonly state: DeckState;
  readonly actions: DeckActions;
  readonly scope: ProjectScope;
  readonly project: CurrentProject;
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
          activity: scope.activity(state.rows),
          current: project.key,
          unassigned: scope.unassigned(state.rows),
          observed: state.observed,
          drifts: state.drifts,
          // The one age the projects panel prints (P3-T7). Read at render, which is what
          // makes `changed 3d ago` become `4d` without a fetch.
          now: Date.now(),
        })
      }
      disabled={!state.coreUp}
      onImport={actions.onImportProject}
      onForget={actions.onForgetProject}
      onChoose={project.choose}
      onObserve={actions.onObserveProject}
      presets={actions}
    />
  );
}

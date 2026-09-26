'use client';

// The rail — the deck's left column, which folds away since P10-T1.
//
// What it holds is what the left column always held: projects, spend, Ask, transcript search and
// the launch form. In the Panes view the session list is still under them, which is the deck as it
// was before the board. In the Board view the cards are in the columns instead, so the rail keeps
// only the launch form — one list of cards on screen at a time, never two.
//
// **Folded is `hidden`, not unmounted.** The palette's "launch", "import" and "search transcripts"
// put the caret in a control in here by id (`focusControl`), and a control that did not exist while
// folded could not be reached; `focusControl` unfolds the rail first (`deck-keyboard.ts`).
import type { JSX } from 'react';
import type { DeckViewMode } from '../../contracts/deck-view.ts';
import type { DeckActions } from './deck-commands.ts';
import type { DeckState } from './deck-store.ts';
import { AskPanel } from './ask-panel.tsx';
import { LaunchForm } from './launch-form.tsx';
import { ProjectsPanel } from './projects-panel.tsx';
import { ProjectsViewModel } from './projects-view-model.ts';
import { SessionList, type SessionListProps } from './session-list.tsx';
import { SpendPanel } from './spend-panel.tsx';
import { TranscriptSearchPanel } from './transcript-search-panel.tsx';
import type { ProjectScope } from './project-scope.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { CurrentProject } from './use-current-project.ts';

export interface DeckRailProps {
  readonly view: DeckViewMode;
  readonly folded: boolean;
  readonly onFold: (folded: boolean) => void;
  readonly list: SessionListProps;
  /** Every session, not the narrowed list: a search hit may be in another project (P7-T2). */
  readonly everyRow: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly scope: ProjectScope;
  readonly project: CurrentProject;
  readonly actions: DeckActions;
}

export function DeckRail(props: DeckRailProps): JSX.Element {
  const { folded, onFold } = props;
  return (
    <div
      className={`deck-left${folded ? ' is-folded' : ''}`}
      data-rail-folded={folded || undefined}
    >
      <button
        type="button"
        className="ghost rail-toggle"
        data-rail-toggle
        aria-expanded={!folded}
        title={folded ? 'Show projects, spend, Ask and the launch form' : 'Fold the rail away'}
        onClick={() => {
          onFold(!folded);
        }}
      >
        {folded ? '»' : '« fold'}
      </button>
      <div className="rail-panels" hidden={folded}>
        <RailPanels {...props} />
      </div>
    </div>
  );
}

/** Everything above the sessions, then the sessions themselves or only the launch form. */
function RailPanels(props: DeckRailProps): JSX.Element {
  const { state, now, actions, list } = props;
  return (
    <>
      <DeckProjects state={state} actions={actions} scope={props.scope} project={props.project} />
      {/* P7-T3. Under the projects, because what it answers is where the money went by folder. */}
      <SpendPanel
        spend={state.spend}
        projects={state.projects}
        disabled={!state.coreUp}
        onRead={actions.onReadSpend}
      />
      {/* P4-T4. Above the sessions: a question is a thing you START, like a launch. */}
      <AskPanel
        run={state.ask}
        refusal={state.askRefusal}
        quota={state.quota}
        now={now}
        disabled={!state.coreUp}
        onAsk={actions.onAsk}
        onClear={actions.onClearAsk}
      />
      {/* P7-T2. Under Ask: both are questions, and this one is about what is NOT on screen. */}
      <TranscriptSearchPanel
        projects={state.projects}
        rows={props.everyRow}
        now={now}
        onOpenPane={actions.onOpenPane}
        onResume={actions.onResume}
      />
      <RailSessions view={props.view} list={list} now={now} />
    </>
  );
}

/**
 * The sessions in the Panes view; in the Board view, where the cards are in the columns, only the
 * launch form that heads the list.
 */
function RailSessions({
  view,
  list,
  now,
}: Pick<DeckRailProps, 'view' | 'list' | 'now'>): JSX.Element {
  if (view !== 'board') return <SessionList {...list} />;
  return (
    <section className="rail-launch" aria-label="start a session">
      <LaunchForm
        disabled={!list.coreUp || list.loading}
        quota={list.quota}
        now={now}
        onLaunch={list.onLaunch}
      />
    </section>
  );
}

/**
 * The projects panel and everything it draws from.
 *
 * The view model is built here rather than in the store, which holds wire values: a view model is
 * presentation and the store is state (CODING-STANDARDS §3).
 */
function DeckProjects({
  state,
  actions,
  scope,
  project,
}: Pick<DeckRailProps, 'state' | 'actions' | 'scope' | 'project'>): JSX.Element {
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

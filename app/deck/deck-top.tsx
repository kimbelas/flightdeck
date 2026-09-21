'use client';

// Everything above the deck's two columns — the header, the installation panel and the banners.
//
// Split out of `deck-view.tsx` in P3-T6, for the reason `deck-body.tsx` and `deck-install.tsx`
// were: that file has a 250-line limit and reached it again. The seam is the same one too —
// `DeckView` composes and holds the state that is genuinely the page's, and this arranges. Nothing
// here fetches and nothing here decides.
//
// `projectTargets` rides along rather than living in `deck-commands.ts`, because it is the join
// between two things this page holds — the registry in `DeckState` and the `ProjectScope` built
// from it — and `deck-commands.ts` is deliberately a list of entries rather than a place that
// knows what a project is.
import type { JSX } from 'react';
import { projectKey } from '../../contracts/project.ts';
import { DeckBanners } from './deck-banners.tsx';
import { DeckHeader } from './deck-header.tsx';
import { DeckInstall } from './deck-install.tsx';
import type { DeckActions, ProjectTarget } from './deck-commands.ts';
import type { DeckState } from './deck-state.ts';
import type { ProjectScope } from './project-scope.ts';

interface DeckTopProps {
  readonly state: DeckState;
  readonly now: number;
  /** Every session, not the narrowed list: the header counts the machine, not the current project. */
  readonly count: number;
  readonly install: boolean;
  readonly actions: DeckActions;
}

export function DeckTop({ state, now, count, install, actions }: DeckTopProps): JSX.Element {
  return (
    <>
      <DeckHeader
        coreUp={state.coreUp}
        sessionCount={count}
        quota={state.quota}
        now={now}
        loading={state.loading}
        onRefresh={actions.onRefresh}
        onOpenShell={actions.onOpenShell}
        onOpenInstall={actions.onOpenInstall}
      />
      {install && <DeckInstall state={state} actions={actions} />}
      <DeckBanners error={state.error} unreadable={state.unreadable} />
    </>
  );
}

/**
 * The imported folders as palette entries — P3-T6.
 *
 * The session counts come off the same `ProjectScope` the panel draws from, so an entry and a row
 * cannot disagree about how much is happening in a folder.
 */
export function projectTargets(state: DeckState, scope: ProjectScope): readonly ProjectTarget[] {
  const activity = scope.activity(state.rows);
  return state.projects.map((record) => ({
    key: projectKey(record.path),
    name: record.name,
    sessions: activity[projectKey(record.path)]?.sessions ?? 0,
  }));
}

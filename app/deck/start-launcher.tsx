'use client';

// The Start launcher — P10-T2, the header's Start button. Project, account, how to start, Start.
//
// A dialog over the board, absent rather than hidden when closed (the palette's rule: a box that
// exists behind `display: none` can hold focus while looking closed). It holds only its draft;
// what the draft means is `StartLauncherViewModel`'s, and what a press does is `useStartLauncher`'s
// — which closes this on core's 201 and opens the new session's card once the sweep publishes it.
// `Esc` closes it through the deck's own listener (`closeStartLauncher`), which sees every key first.
import { useEffect, useRef, useState, type JSX, type MouseEvent, type RefObject } from 'react';
import { projectKey } from '../../contracts/project.ts';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckState } from './deck-state.ts';
import { importRefusalLine } from './projects-view-model.ts';
import { AccountStep, ProjectStep, StarterStep } from './start-launcher-steps.tsx';
import {
  EMPTY_START_DRAFT,
  StartLauncherViewModel,
  type StartDraft,
} from './start-launcher-view-model.ts';
import type { StartMemory } from './use-start-memory.ts';

export interface StartLauncherProps {
  readonly state: DeckState;
  readonly now: number;
  readonly memory: StartMemory;
  /** Whether a press is in flight — the button waits for core rather than being pressed twice. */
  readonly starting: boolean;
  /** Why the last press started nothing, or `undefined`. Said here: the banner is under the scrim. */
  readonly failure: string | undefined;
  readonly onImport: (path: string) => void;
  readonly onStart: (request: PresetLaunch, account: SubscriptionId, projectKey: string) => void;
  readonly onClose: () => void;
}

export function StartLauncher(props: StartLauncherProps): JSX.Element {
  const { state, memory } = props;
  const [draft, setDraft] = useState<StartDraft>(EMPTY_START_DRAFT);
  const imported = useImportedTile(state, props.onImport, setDraft);
  const model = modelOf(props, draft);
  const dialog = useFocusOnOpen();
  const change = (next: Partial<StartDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const refusal = state.importRefusal;
  return (
    <div className="scrim start-scrim" role="presentation" onMouseDown={onScrim(props.onClose)}>
      <section
        className="start-launcher"
        role="dialog"
        aria-modal="true"
        aria-label="Start work"
        data-start-launcher
        ref={dialog}
      >
        <StartHead onClose={props.onClose} />
        <ol className="start-steps">
          <ProjectStep
            model={model}
            draft={draft}
            onDraft={change}
            refusal={refusal === undefined ? undefined : importRefusalLine(refusal)}
            onImport={imported}
          />
          <LaterSteps model={model} draft={draft} onDraft={change} memory={memory} />
        </ol>
        <StartFoot {...props} model={model} />
      </section>
    </div>
  );
}

/** The view model over what the deck holds and what has been picked. Rebuilt per render. */
function modelOf(props: StartLauncherProps, draft: StartDraft): StartLauncherViewModel {
  const { state } = props;
  return new StartLauncherViewModel({
    projects: state.projects,
    maps: state.maps,
    quota: state.quota,
    memory: props.memory.memory,
    draft,
    now: props.now,
  });
}

function StartHead({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <header className="start-head">
      <h2>Start work</h2>
      <button type="button" className="ghost" aria-label="close" data-start-close onClick={onClose}>
        ✕
      </button>
    </header>
  );
}

/** Steps 2 and 3, once there is a project — an account and a skill mean nothing before one. */
function LaterSteps({
  model,
  draft,
  onDraft,
  memory,
}: {
  readonly model: StartLauncherViewModel;
  readonly draft: StartDraft;
  readonly onDraft: (change: Partial<StartDraft>) => void;
  readonly memory: StartMemory;
}): JSX.Element | null {
  const project = model.project;
  if (project === undefined) return null;
  return (
    <>
      <AccountStep
        model={model}
        draft={draft}
        onDraft={onDraft}
        onLock={(locked) => {
          memory.lock(projectKey(project.path), model.account, locked);
        }}
      />
      <StarterStep model={model} draft={draft} onDraft={onDraft} />
    </>
  );
}

/** The one button, saying what is missing until nothing is — then which account it starts on. */
function StartFoot(
  props: StartLauncherProps & { readonly model: StartLauncherViewModel },
): JSX.Element {
  const { model, starting, failure } = props;
  const launch = model.launch();
  const project = model.project;
  return (
    <footer className="start-foot">
      {failure !== undefined && !starting && (
        <p className="start-refusal" data-start-failure>
          {failure}
        </p>
      )}
      <button
        type="button"
        className="new-session start-go"
        data-start-go
        disabled={launch === undefined || starting || !props.state.coreUp}
        onClick={() => {
          if (launch !== undefined && project !== undefined) {
            props.onStart(launch, model.account, projectKey(project.path));
          }
        }}
      >
        {starting ? 'Starting…' : (model.missing ?? `Start on ${model.account}`)}
      </button>
    </footer>
  );
}

/**
 * Importing from "choose folder…", and picking the tile it becomes.
 *
 * The typed path is held until a project with its key arrives in the registry, then chosen: the
 * owner asked for THAT folder, so making them find its new tile would be a second question.
 */
function useImportedTile(
  state: DeckState,
  onImport: (path: string) => void,
  setDraft: (update: (current: StartDraft) => StartDraft) => void,
): (path: string) => void {
  const [waiting, setWaiting] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (waiting === undefined) return;
    if (!state.projects.some((project) => projectKey(project.path) === waiting)) return;
    setWaiting(undefined);
    setDraft((current) => ({
      ...current,
      projectKey: waiting,
      account: undefined,
      starter: undefined,
    }));
  }, [state.projects, waiting, setDraft]);
  return (path: string) => {
    setWaiting(projectKey(path));
    onImport(path);
  };
}

/**
 * The caret goes to the first tile when the launcher opens, so the keyboard starts where the
 * choosing does rather than on the header's Start button behind the scrim.
 */
function useFocusOnOpen(): RefObject<HTMLElement | null> {
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('.start-tile')?.focus();
  }, []);
  return dialog;
}

/** A press on the backdrop, not one that started inside the dialog and was dragged out. */
function onScrim(close: () => void): (event: MouseEvent<HTMLDivElement>) => void {
  return (event) => {
    if (event.target === event.currentTarget) close();
  };
}

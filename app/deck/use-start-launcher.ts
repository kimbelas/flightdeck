// What pressing Start does — P10-T2.
//
// Launch through the store (the same `POST /sessions` every other start sends), remember the
// account for that project, close the launcher, and then — once the reconciler's sweep publishes
// the new row — open it: on the board that is the card's modal, which attaches the pane and puts
// the caret in its terminal (P10-T1), so the owner is typing into the session with no second press.
// In the Panes view it is the pane.
//
// **Opened on ARRIVAL, not on the 201.** Core answers with the id as soon as `--bg` returns, and
// the row reaches the deck a sweep later; a card cannot be opened before it exists. The id is held
// until then. `--bg` may print only the short id (`firstSessionId`), so a row matches by prefix.
//
// **A project filter that would hide it is cleared.** Starting a session in xpert-new while the
// board is narrowed to isg would otherwise open a card nobody can see.
import { useCallback, useEffect, useState } from 'react';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckViewMode } from '../../contracts/deck-view.ts';
import type { DeckStore } from './deck-store.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { StartMemory } from './use-start-memory.ts';
import type { CurrentProject } from './use-current-project.ts';

export interface StartLauncherParts {
  readonly store: DeckStore;
  readonly rows: readonly SessionRowViewModel[];
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (row: SessionRowViewModel) => void;
  readonly openPane: (row: SessionRowViewModel) => void;
  readonly view: DeckViewMode;
  readonly project: CurrentProject;
  /** Which project a folder is in — `ProjectScope.keyFor`. */
  readonly keyFor: (cwd: string) => string | undefined;
  readonly memory: StartMemory;
}

export interface StartLauncherControl {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly starting: boolean;
  /** Why the last press did not start anything, in the store's words, or `undefined`. */
  readonly failure: string | undefined;
  readonly start: (request: PresetLaunch, account: SubscriptionId, projectKey: string) => void;
}

interface Pending {
  /** `<subscription>:<id>` — the start of the row key the session will arrive under. */
  readonly prefix: string;
}

export function useStartLauncher(parts: StartLauncherParts): StartLauncherControl {
  const { store, memory } = parts;
  const [open, setOpenState] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  useOpenOnArrival(parts, pending, setPending);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setFailure(undefined);
  }, []);

  const start = useCallback(
    (request: PresetLaunch, account: SubscriptionId, projectKey: string) => {
      setStarting(true);
      setFailure(undefined);
      void store.launch(request).then((sessionId) => {
        setStarting(false);
        if (sessionId === undefined) {
          setFailure(store.snapshot().error ?? 'Core would not start that session.');
          return;
        }
        memory.remember(projectKey, account);
        setOpenState(false);
        setPending({ prefix: `${account}:${sessionId}` });
      });
    },
    [store, memory],
  );

  return { open, setOpen, starting, failure, start };
}

/** Opens the launched session once its row is on the deck — see the header. */
function useOpenOnArrival(
  parts: StartLauncherParts,
  pending: Pending | undefined,
  clear: (pending: undefined) => void,
): void {
  const { rows, expanded, toggle, openPane, view, project, keyFor } = parts;
  useEffect(() => {
    if (pending === undefined) return;
    const row = rows.find((each) => each.key.startsWith(pending.prefix));
    if (row === undefined) return;
    clear(undefined);
    const home = row.cwd === undefined ? undefined : keyFor(row.cwd);
    if (project.key !== undefined && project.key !== home) project.choose(undefined);
    if (view !== 'board') openPane(row);
    else if (!expanded.has(row.key)) toggle(row);
  }, [pending, rows, expanded, toggle, openPane, view, project, keyFor, clear]);
}

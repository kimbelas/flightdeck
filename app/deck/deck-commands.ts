// What is in the palette — and, as much, what is not.
//
// SPEC §5.4 names six things Ctrl+K should reach: launch, switch project, jump to session, run Ask,
// change layout, connect. Three of them exist today and are below. The other three are listed here
// so the next person does not have to work out whether they were forgotten:
//
//   - **switch project** — P3-T6. Importing one is here since P3-T1, and switching to one needs
//     the by-project view to switch to.
//   - **run Ask** — P4. Nothing in the deck can ask a question of a session.
//   - **connect** — exists, but as `npm run connect`, and it writes under `~/.claude*` behind a dry
//     run, a diff and a `--apply` opt-in (P1-T11, SEC-ING-3). A palette entry that performed that
//     write on one keypress would defeat every control the task put around it. It stays a CLI.
//
//
// One entry is not in this file: "Keyboard shortcuts" is appended by use-deck-keys.ts, because the
// sheet's open/closed state lives there and a command that opens it from here would need that state
// threaded back out and in again.
//
// A palette entry that does nothing is worse than an absent one: the first no-op teaches you not to
// trust the entries beside it. So the list grows when those tasks land, and not before.
import { PANE_LAYOUTS, type PaneLayout } from '../../contracts/pane-layout.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import {
  focusControl,
  focusRow,
  LAUNCH_PROMPT_ID,
  PROJECT_PATH_ID,
  SEARCH_INPUT_ID,
} from './deck-keyboard.ts';
import type { DeckCommand } from './command-palette-view-model.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';

/**
 * Everything the deck can be asked to do, whatever asked for it.
 *
 * One interface rather than one per caller, because a button and a palette entry that do the same
 * thing must be the same function — the alternative is `open pane` drifting from `Open a pane
 * for …` and only one of them getting the next fix.
 */
export interface DeckActions {
  readonly onOpenShell: () => void;
  readonly onRefresh: () => void;
  readonly onOpenPane: (row: SessionRowViewModel) => void;
  readonly onLaunch: (subscription: SubscriptionId, prompt: string, name: string) => void;
  readonly onImportProject: (path: string) => void;
  readonly onForgetProject: (path: string) => void;
}

export interface CommandTargets extends DeckActions {
  readonly rows: readonly SessionRowViewModel[];
  /** Not on `DeckActions`: the grid owns the layout, and the store owns everything else there. */
  readonly onLayout: (layout: PaneLayout) => void;
}

/** The deck's commands: the always-there ones, the six layouts, then two per session that can be. */
export function deckCommands(targets: CommandTargets): readonly DeckCommand[] {
  return [
    ...globalCommands(targets),
    ...layoutCommands(targets),
    ...targets.rows.flatMap((row) => rowCommands(row, targets)),
  ];
}

/**
 * SPEC §5.4's "change layout", which this file listed as missing until P5a-T5 built the chooser.
 *
 * One entry per layout rather than a "cycle layouts" entry: the palette is searched by typing, and
 * `Ctrl+K 6 Enter` is a shorter path to a six-up than pressing cycle four times and counting.
 */
function layoutCommands(targets: CommandTargets): readonly DeckCommand[] {
  return PANE_LAYOUTS.map((layout) => ({
    id: `layout-${String(layout)}`,
    label: layout === 'focus' ? 'Layout: focus' : `Layout: ${String(layout)}-up`,
    hint: layout === 'focus' ? 'panes · one large, the rest as thumbnails' : 'panes · grid',
    run: () => {
      targets.onLayout(layout);
    },
  }));
}

function globalCommands(targets: CommandTargets): readonly DeckCommand[] {
  return [
    {
      id: 'launch',
      label: 'Start a background session',
      hint: 'launch · --bg needs a first prompt',
      run: () => {
        focusControl(LAUNCH_PROMPT_ID);
      },
    },
    {
      id: 'shell',
      label: 'Open a shell pane',
      hint: 'pane · a plain shell, not a session',
      run: targets.onOpenShell,
    },
    {
      id: 'refresh',
      label: 'Refresh the session list',
      hint: 'deck · re-reads both subscriptions',
      run: targets.onRefresh,
    },
    {
      id: 'search',
      label: 'Filter the session list',
      hint: 'deck · /',
      run: () => {
        focusControl(SEARCH_INPUT_ID);
      },
    },
    {
      id: 'import-project',
      label: 'Import a project',
      // It says what importing does, because the answer is not obvious and is the whole of D26:
      // the folder stays where it is and core is allowed to read it.
      hint: 'projects · by path — nothing is scanned or copied',
      run: () => {
        focusControl(PROJECT_PATH_ID);
      },
    },
  ];
}

/**
 * One session's entries. Jumping always works; opening a pane is offered only where it is possible.
 *
 * The second entry is absent rather than disabled for an interactive session, for the same reason
 * the row's button is (session-row-card.tsx): only `--bg` sessions are attachable (SPEC §5.2), that
 * is permanent, and a palette full of entries that refuse is a palette people stop reading.
 */
function rowCommands(row: SessionRowViewModel, targets: CommandTargets): readonly DeckCommand[] {
  const hint = `${row.subscriptionLabel} · ${row.project} · ${row.stateLabel}`;
  const jump: DeckCommand = {
    id: `jump:${row.key}`,
    label: `Jump to ${row.title}`,
    hint,
    run: () => {
      focusRow(row.key);
    },
  };
  if (!row.canOpenPane) return [jump];
  return [
    jump,
    {
      id: `pane:${row.key}`,
      label: `Open a pane for ${row.title}`,
      hint,
      run: () => {
        targets.onOpenPane(row);
      },
    },
  ];
}

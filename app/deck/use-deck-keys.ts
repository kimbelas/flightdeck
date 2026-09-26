// What a key means once it has been resolved — the one place the deck's keyboard holds state.
//
// The split across three files is on purpose and it is the layering (CODING-STANDARDS §2):
// contracts/keymap.ts decides *whether* a key is live, deck-keyboard.ts reads the browser and moves
// focus, and this joins them to the deck's state. Only this file knows that the palette is open, so
// only this file can answer the one question the keymap deliberately does not carry — `↓` means
// "next result" while the palette is up and "next session" while it is not.
//
// **`live` is a ref, not the render's closure.** The window listener is installed once per
// `paletteOpen`, and the deck re-renders on every stream event and every clock tick; a dispatcher
// closed over that render's palette would either be stale by the time a key arrived or force the
// capturing listener to be torn down and reinstalled a few times a second. The ref is written in an
// effect rather than during render, so it is never mid-update when a keystroke reads it.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { standardKeymap, type DeckAction, type DeckKeymap } from '../../contracts/keymap.ts';
import { CommandPaletteViewModel, type DeckCommand } from './command-palette-view-model.ts';
import {
  blurActive,
  closeCardModal,
  focusControl,
  focusPane,
  moveRowFocus,
  useDeckKeyboard,
  SEARCH_INPUT_ID,
} from './deck-keyboard.ts';

/** Everything the deck renders because of the keyboard. `palette` is `undefined` when closed. */
export interface DeckKeys {
  readonly keymap: DeckKeymap;
  readonly palette: CommandPaletteViewModel | undefined;
  readonly paletteQuery: string;
  readonly sheetOpen: boolean;
  readonly onPaletteQuery: (value: string) => void;
  readonly onPaletteSelect: (index: number) => void;
  readonly onPaletteRun: (command: DeckCommand) => void;
  readonly onClosePalette: () => void;
  readonly onCloseSheet: () => void;
}

interface Live {
  readonly palette: CommandPaletteViewModel;
  readonly open: boolean;
  readonly sheetOpen: boolean;
  /** In the ref for the same reason the palette is: `[`/`]` depend on which pane has focus. */
  readonly actions: DeckKeyActions;
}

interface Controls {
  readonly setOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSheet: Dispatch<SetStateAction<boolean>>;
  readonly setQuery: Dispatch<SetStateAction<string>>;
  readonly setCursor: Dispatch<SetStateAction<number>>;
}

type PaletteHandlers = Omit<DeckKeys, 'keymap' | 'palette' | 'paletteQuery' | 'sheetOpen'>;

/** What the keyboard needs from the deck that is not the palette's — the pane grid, today. */
export interface DeckKeyActions {
  readonly onMovePane: (delta: number) => void;
}

/**
 * @param commandsFor the palette's entries for what is typed. A function rather than a list since
 * P9-T4, because one entry — `Plan <id> in <project>` — is built from the query itself; the query
 * is this hook's state, so it is handed out here rather than threaded back in (`deck-commands.ts`).
 */
export function useDeckKeys(
  commandsFor: (query: string) => readonly DeckCommand[],
  actions: DeckKeyActions,
): DeckKeys {
  const keymap = useMemo(() => standardKeymap(), []);
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const controls = useMemo<Controls>(() => ({ setOpen, setSheet, setQuery, setCursor }), []);

  // The sheet's own command is appended here rather than built in deck-commands.ts: `?` opens the
  // sheet, the sheet's state is this hook's, and threading that state out and back would be the
  // long way round to the same place.
  const palette = new CommandPaletteViewModel(
    [...commandsFor(query), shortcutsCommand(controls)],
    query,
    cursor,
  );
  const live = useRef<Live>({ palette, open, sheetOpen, actions });
  useEffect(() => {
    live.current = { palette, open, sheetOpen, actions };
  });

  const onAction = useCallback(
    (action: DeckAction) => {
      runAction(action, live.current, controls);
    },
    [controls],
  );
  useDeckKeyboard(keymap, open, onAction);

  return {
    keymap,
    palette: open ? palette : undefined,
    paletteQuery: query,
    sheetOpen,
    ...handlersFor(controls),
  };
}

function shortcutsCommand(controls: Controls): DeckCommand {
  return {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    hint: 'deck · ?',
    run: () => {
      controls.setSheet(true);
    },
  };
}

/** The mouse's half. Clicking a result and pressing Enter on it must do the same thing. */
function handlersFor(controls: Controls): PaletteHandlers {
  return {
    onPaletteQuery: (value: string) => {
      // Back to the first result: after narrowing, the old cursor points at a different command.
      controls.setQuery(value);
      controls.setCursor(0);
    },
    onPaletteSelect: (index: number) => {
      controls.setCursor(index);
    },
    onPaletteRun: (command: DeckCommand) => {
      controls.setOpen(false);
      command.run();
    },
    onClosePalette: () => {
      controls.setOpen(false);
    },
    onCloseSheet: () => {
      controls.setSheet(false);
    },
  };
}

/** One action, once. Exhaustive over `DeckAction` so a new key cannot be added and forgotten. */
function runAction(action: DeckAction, live: Live, controls: Controls): void {
  switch (action.kind) {
    case 'toggle-palette':
      togglePalette(live, controls);
      return;
    case 'toggle-shortcuts':
      controls.setSheet((shown) => !shown);
      return;
    case 'dismiss':
      dismiss(live, controls);
      return;
    case 'move-selection':
      // The one action whose meaning depends on what is on screen — see the header.
      if (live.open) controls.setCursor(live.palette.stepped(action.delta));
      else moveRowFocus(action.delta);
      return;
    case 'run-selection':
      runSelected(live, controls);
      return;
    case 'focus-search':
      focusControl(SEARCH_INPUT_ID);
      return;
    case 'focus-pane':
      focusPane(action.position);
      return;
    case 'move-pane':
      live.actions.onMovePane(action.delta);
      return;
  }
}

/** Opening clears the query: a palette that reopens on last week's search is a palette with a bug. */
function togglePalette(live: Live, controls: Controls): void {
  if (live.open) {
    controls.setOpen(false);
    return;
  }
  controls.setQuery('');
  controls.setCursor(0);
  controls.setSheet(false);
  controls.setOpen(true);
}

/** `Esc`, innermost first — and with nothing open it is how someone leaves a text field. */
function dismiss(live: Live, controls: Controls): void {
  if (live.open) {
    controls.setOpen(false);
    return;
  }
  if (live.sheetOpen) {
    controls.setSheet(false);
    return;
  }
  if (closeCardModal()) return;
  blurActive();
}

function runSelected(live: Live, controls: Controls): void {
  const command = live.palette.selected;
  if (command === undefined) return;
  controls.setOpen(false);
  command.run();
}

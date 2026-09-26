// The DOM half of the keyboard, and deliberately the only half — contracts/keymap.ts has the rest.
//
// Everything below either reads the browser or moves focus. There is no decision in this file:
// which key is live where is `keyContextFor` and `DeckKeymap.resolve`, both of which are testable
// without a page, and what an action means is `useDeckKeys`. What is left here is the part that
// genuinely needs a DOM, kept small enough to read in one sitting for exactly that reason.
//
// **The listener is on `window` in the capture phase.** Bubbling is too late: xterm handles keys on
// its own hidden textarea, so a bubbling listener would see `Ctrl+K` only after the pane had
// already sent it to the shell. Capturing is also what makes the context test load-bearing rather
// than decorative — the deck now sees *every* keystroke on the page first, including every
// character typed into a session, and the only thing standing between that and a swallowed prompt
// is `keyContextFor` returning `terminal` or `text`.
//
// **Focus is moved, not tracked.** `j`/`k` call `.focus()` on the session row's own button rather
// than setting a `selected` index, which buys `Enter`, `Space`, scroll-into-view and the screen
// reader's announcement for nothing. A parallel "selected row" that the DOM's focus does not follow
// is how a keyboard UI and its accessibility tree drift apart, and this one has no way to drift.
import { useEffect } from 'react';
import {
  keyContextFor,
  stepIndex,
  type DeckAction,
  type DeckKeymap,
  type FocusProbe,
  type KeyStroke,
} from '../../contracts/keymap.ts';

/** The controls the keyboard puts focus in by name. Owned here because focusing them is. */
export const SEARCH_INPUT_ID = 'deck-search';
export const LAUNCH_PROMPT_ID = 'launch-prompt';
/** Where a project path is typed — the palette's "Import a project" focuses this (P3-T1). */
export const PROJECT_PATH_ID = 'project-path';
/** The box that searches every transcript — the palette's "Search every transcript" (P7-T2). */
export const TRANSCRIPT_SEARCH_ID = 'transcript-search';

/** The session rows' expand buttons, in the order they are on screen. Filtering changes this. */
const ROW_SELECTOR = '[data-deck-row]';
/** A pane card, by its position from the left — the attribute carries it (see `focusPane`). */
const paneSelector = (position: number): string =>
  `[data-deck-pane="${CSS.escape(String(position))}"]`;
/** xterm's own hidden input. Focusing the pane's box does nothing; focusing this types into it. */
const TERMINAL_INPUT = '.xterm-helper-textarea';

/**
 * Installs the deck's one keydown listener for as long as the deck is mounted.
 *
 * `onAction` must be stable — this re-subscribes when it changes, and a handler rebuilt on every
 * render would mean adding and removing a capturing window listener on every stream event.
 */
export function useDeckKeyboard(
  keymap: DeckKeymap,
  paletteOpen: boolean,
  onAction: (action: DeckAction) => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Mid-composition an IME reports `key: 'Process'` and every Enter belongs to the candidate
      // list, not to us. Leaving it alone is the only correct behaviour here.
      if (event.isComposing) return;
      const context = keyContextFor(probeOf(event.target, paletteOpen));
      const action = keymap.resolve(strokeOf(event), context);
      if (action === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      onAction(action);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [keymap, paletteOpen, onAction]);
}

function strokeOf(event: KeyboardEvent): KeyStroke {
  return { key: event.key, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
}

/** The four facts `keyContextFor` needs, and nothing else — `closest` is the only DOM walk here. */
function probeOf(target: EventTarget | null, paletteOpen: boolean): FocusProbe {
  const element = target instanceof HTMLElement ? target : null;
  return {
    tagName: element?.tagName ?? '',
    editable: element?.isContentEditable ?? false,
    inTerminal: element !== null && element.closest('.pane-host') !== null,
    paletteOpen,
  };
}

/**
 * Moves focus one session row, wrapping.
 *
 * The current row is read back out of the document rather than remembered. That sounds like the
 * long way round and is the short one: the list is filtered by `/`, reordered by the stream and
 * re-rendered on every event, so an index held in React state would point at whichever row had
 * since taken that position. `document.activeElement` cannot be stale.
 */
export function moveRowFocus(delta: number): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
  const current = rows.findIndex((row) => row === document.activeElement);
  const next = rows[stepIndex(current, delta, rows.length)];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
}

/**
 * Types into pane `position`, counting from the left — `1`–`9`.
 *
 * Nothing happens above the number of open panes, which is the honest behaviour: a key that
 * quietly focused the last pane instead would be worse than a key that does nothing.
 *
 * **Resolved by the attribute's value, not by document order** (P5a-T5). The two agreed while
 * every layout was a plain grid; focus mode puts the focused pane in a row of its own, and a digit
 * that counted DOM children would renumber every pane the moment somebody clicked into one.
 */
export function focusPane(position: number): void {
  const pane = document.querySelector<HTMLElement>(paneSelector(position - 1));
  pane?.querySelector<HTMLTextAreaElement>(TERMINAL_INPUT)?.focus();
}

/**
 * Puts focus in a named control — the search box for `/`, the prompt for the launch command.
 *
 * A control in the folded rail (P10-T1) is unfolded to first, by the rail's own toggle — `hidden`
 * cannot hold focus — and focused on the next frame, once the render that click caused is on
 * screen. `openPreset` below does the same for the same reason.
 */
export function focusControl(id: string): void {
  const control = document.getElementById(id);
  if (control === null) return;
  const toggle = control
    .closest('[data-rail-folded]')
    ?.querySelector<HTMLElement>('[data-rail-toggle]');
  if (toggle === null || toggle === undefined) {
    focusNow(control);
    return;
  }
  toggle.click();
  requestAnimationFrame(() => {
    focusNow(control);
  });
}

function focusNow(control: HTMLElement): void {
  control.focus();
  control.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens one preset's editor and puts the caret in `box` — the palette's `Launch` for a preset that
 * cannot start as it stands (P9-T4, `preset-targets.ts`).
 *
 * The chip's own click, not a second way to select it: the panel's state stays the panel's, and a
 * press lands exactly where pressing the chip would. A chip already open is not clicked again,
 * because a second click is the chip's toggle and would close it. The editor exists only after the
 * render that click caused, so the caret is placed on the next frame.
 */
export function openPreset(chip: string, box: 'name' | 'prompt'): void {
  const button = document.querySelector<HTMLElement>(`[data-preset-chip="${CSS.escape(chip)}"]`);
  if (button === null) return;
  if (button.getAttribute('aria-pressed') !== 'true') button.click();
  requestAnimationFrame(() => {
    const panel = button.closest('.presets');
    const field = box === 'name' ? '.preset-session-name' : '.preset-prompt';
    const control = panel?.querySelector<HTMLElement>(`.preset-editor ${field}`);
    control?.focus();
    control?.scrollIntoView({ block: 'nearest' });
  });
}

/** Focuses and expands one session row by its key. The palette's "jump to session". */
export function focusRow(key: string): void {
  const row = document.querySelector<HTMLElement>(`[data-deck-row="${CSS.escape(key)}"]`);
  row?.focus();
  row?.scrollIntoView({ block: 'nearest' });
}

/** What `Esc` does in a text field: hands the keyboard back to the deck. */
export function blurActive(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

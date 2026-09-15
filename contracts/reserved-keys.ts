// The keys the deck does not own, and why — the half of the `?` sheet that is not a keymap.
//
// **This file re-derives nothing. RESEARCH.md E.2 already measured all of it**, and the sheet
// exists to put those findings in front of the person who is about to press Ctrl+W and lose a
// window, rather than leaving them in a document nobody reads mid-session:
//
//   - `navigator.keyboard.lock()` works **only in JavaScript-initiated fullscreen**. Not in a
//     windowed PWA and not in the Edge `--app=` window the deck runs in, which is the one that
//     matters here. Chrome's proposed permission prompt for it (Chrome 131) was **not shipped**
//     (March 2026), so fullscreen is the only gate and there is no dialog to grant.
//   - **Ctrl+W still closes an installed PWA or `--app` window** (microsoft/vscode#150735). There
//     is no documented way to suppress it outside fullscreen + Keyboard Lock.
//   - Nobody reclaims Ctrl+W in a window. VS Code for the Web **documents** Ctrl+N/Ctrl+W as
//     browser-reserved; code-server (#2586, #112) detects standalone mode and **remaps** its own
//     bindings out of the way instead.
//
// So the deck lists them. Listing is the whole intervention, and it is the correct one: the only
// place this changes is the Tauri shell — no tabs and no window chrome, so most of these have no
// default action left to fight — and confirming Ctrl+W reaches the page there is P5b's first task
// (RESEARCH.md E.3), not this one.
//
// The other reason this is a list and not a feature: SPEC §5.3's keyboard helper, which writes the
// Ctrl+W/Ctrl+T remaps into both config directories, is a different task with a different blast
// radius. Nothing in P2-T5 goes near `~/.claude*`.

/** A key the deck does not handle, with who does handle it and what that costs. */
export interface ReservedKey {
  readonly label: string;
  /** What actually happens when it is pressed. Present tense — this is not a warning, it is a fact. */
  readonly effect: string;
}

/**
 * Taken by the browser or by Windows before the page sees them. Unreclaimable in this window.
 *
 * The blunt ones first: someone scanning this sheet is usually looking for "why did my window
 * vanish", and Ctrl+W is the answer often enough to earn the top row.
 */
export const BROWSER_OWNED_KEYS: readonly ReservedKey[] = [
  {
    label: 'Ctrl+W',
    effect: 'Closes the window — panes and all. The sessions keep running; reopen the deck.',
  },
  { label: 'Ctrl+Shift+W', effect: 'Closes the window. Same as above.' },
  { label: 'Alt+F4', effect: "Closes the window. Windows', not the browser's." },
  { label: 'Ctrl+T · Ctrl+N', effect: 'Opens a browser tab or window behind the app window.' },
  { label: 'Ctrl+R · F5', effect: 'Reloads the deck. Panes detach and reconnect; nothing stops.' },
  { label: 'F11', effect: 'Fullscreen. The one mode where a page could take these keys back.' },
  { label: 'Ctrl+± · Ctrl+0', effect: 'Zoom. Terminal panes resize and the PTY is told.' },
];

/**
 * Keys the deck deliberately does NOT bind, because the browser already does the right thing.
 *
 * `Enter` is the one worth spelling out. `j`/`k` move real DOM focus onto the row's own button, so
 * `Enter` and `Space` arrive as that button's activation — which is why the keymap leaves them
 * alone. Binding them would mean `preventDefault`-ing them, and that breaks `refresh`, `open pane`
 * and every other control the moment one of them holds focus (keymap.ts).
 */
export const NATIVE_KEYS: readonly ReservedKey[] = [
  {
    label: 'Enter · Space',
    effect: 'Activates whatever has focus — after j/k that is the session row, so it expands.',
  },
  {
    label: 'Tab · Shift+Tab',
    effect: 'Moves focus the way it does on any page. Nothing overrides it.',
  },
];

/**
 * The one key the deck takes away from a terminal pane, said out loud.
 *
 * Everything else in a pane belongs to the program running in it — `Esc` above all, which is why
 * `Esc` is not bound in the `terminal` context. `Ctrl+K` is the exception, and the trade is worth
 * naming on the sheet rather than discovering: a pane that swallows the only global key is a pane
 * you cannot leave without reaching for the mouse.
 */
export const TERMINAL_CLAIMED: readonly ReservedKey[] = [
  {
    label: 'Ctrl+K',
    effect: 'Opens the palette instead of reaching the shell — the deck claims this one key.',
  },
];

// The deck's keyboard, as a table — SPEC §5.4, CODING-STANDARDS §3.
//
// **The keymap is not the hard part; focus is.** The deck is a page with xterm panes on it, and an
// xterm pane is a textarea that wants every keystroke. A global `keydown` that turns `j` into
// "next session" while someone is typing a prompt into a Claude session is the whole bug this task
// could ship, and it would not fail a single test — nothing here renders, so nothing here would
// notice. So the question this file answers is not "which key does what" but **"which key does
// what, and is that key live right now"**, and it answers it against a `KeyContext` rather than
// against the DOM. `keyContextFor` below turns four facts about the focused element into that
// context; app/deck/deck-keyboard.ts reads those four facts and knows nothing else.
//
// The rule that falls out, and the reason the table has a `contexts` column at all:
//
//   - `terminal` — **only `Ctrl+K`**. Not `Esc`: `Esc` belongs to vim, to Claude Code's own TUI
//     and to every program that will ever run in a pane, and a deck that swallows it is a deck you
//     cannot work in. `Ctrl+K` is taken deliberately and is the one key the pane does not get
//     (see `TERMINAL_CLAIMED` in reserved-keys.ts) — a pane that can swallow the only global key
//     is a pane you cannot leave without the mouse.
//   - `text` — `Ctrl+K` and `Esc`, nothing else. `Esc` blurs, which is how someone who has clicked
//     into the launch prompt gets `j`/`k` back. Every printable key belongs to the field.
//   - `palette` — arrows, `Enter`, `Esc`, `Ctrl+K`. The palette has a text input in it, so `j` and
//     `k` must type rather than navigate; `↑`/`↓` are bound there instead and `j`/`k` are not.
//   - `deck` — everything.
//
// `Enter` is deliberately absent from the `deck` row and it is not an oversight: `j`/`k` move real
// DOM focus onto the session row's own button, so `Enter` and `Space` are the browser's, already
// doing the right thing. Binding `Enter` globally would mean `preventDefault`-ing it — which
// breaks `refresh`, `open pane` and every other button the moment one of them holds focus. It is
// listed in the shortcut sheet through `NATIVE_KEYS` instead, which is honest about who handles it.
//
// **Nothing here touches `~/.claude*`.** SPEC §5.3's helper that writes the Ctrl+W/Ctrl+T remaps
// into both config directories is a different task with a different blast radius; `npm run connect`
// and `npm run disconnect` are the only sanctioned writers (CLAUDE.md). This file lists the
// browser-owned keys. It does not reclaim them, and it could not — see reserved-keys.ts.

/** Where focus is, which is what decides whether a binding is live. */
export type KeyContext = 'deck' | 'text' | 'terminal' | 'palette';

/**
 * One keydown, reduced to the four things a binding may look at.
 *
 * Deliberately not a `KeyboardEvent`: this file compiles in the Node project, where there is no
 * DOM, and every test below is a plain object literal rather than a synthesised event.
 *
 * `shift` is absent on purpose. For printable keys the browser has already folded it into `key` —
 * `?` is `Shift+/` and arrives as `'?'`, `J` arrives as `'J'` and so never matches `'j'` — so a
 * `shift` column would be a second, disagreeing source for the same fact.
 */
export interface KeyStroke {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/** What a key means, once. A union so the deck's dispatcher is exhaustively switched (R12). */
export type DeckAction =
  | { readonly kind: 'toggle-palette' }
  | { readonly kind: 'move-selection'; readonly delta: number }
  | { readonly kind: 'run-selection' }
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'focus-search' }
  | { readonly kind: 'toggle-shortcuts' }
  | { readonly kind: 'focus-pane'; readonly position: number }
  | { readonly kind: 'move-pane'; readonly delta: number };

/** How the shortcut sheet groups the table. Presentation, but it belongs with the table. */
export type KeySection = 'global' | 'sessions' | 'panes' | 'palette';

/**
 * One row of the table: what it is called, what it does, and where it is live.
 *
 * An interface with two implementations rather than one class with a special case, because `1`–`9`
 * is a family of nine keys whose action carries the digit and the other bindings are fixed (R2/R4).
 */
export interface KeyBinding {
  readonly label: string;
  readonly description: string;
  readonly section: KeySection;
  isLiveIn(context: KeyContext): boolean;
  actionFor(stroke: KeyStroke): DeckAction | undefined;
}

interface ChordSpec {
  readonly label: string;
  readonly description: string;
  readonly section: KeySection;
  readonly contexts: readonly KeyContext[];
  /** Every key that means this. `['j', 'ArrowDown']` is one binding, not two rows in the sheet. */
  readonly keys: readonly string[];
  /** Stated rather than optional: a binding that forgets to say is a binding that fires on Ctrl. */
  readonly ctrl: boolean;
  readonly action: DeckAction;
}

/** A fixed chord. `Alt` and `Meta` never match — those belong to Windows and to the browser. */
export class ChordBinding implements KeyBinding {
  private readonly spec: ChordSpec;

  constructor(spec: ChordSpec) {
    this.spec = spec;
  }

  public get label(): string {
    return this.spec.label;
  }

  public get description(): string {
    return this.spec.description;
  }

  public get section(): KeySection {
    return this.spec.section;
  }

  public isLiveIn(context: KeyContext): boolean {
    return this.spec.contexts.includes(context);
  }

  public actionFor(stroke: KeyStroke): DeckAction | undefined {
    if (stroke.alt || stroke.meta) return undefined;
    if (stroke.ctrl !== this.spec.ctrl) return undefined;
    return this.spec.keys.includes(stroke.key) ? this.spec.action : undefined;
  }
}

/** `1`–`9`, as one binding whose action carries the position. `0` is not a pane. */
export class PaneDigitBinding implements KeyBinding {
  private static readonly DIGITS = '123456789';

  public readonly label = '1 – 9';
  public readonly description = 'Focus that pane, counting from the left';
  public readonly section: KeySection = 'panes';

  private readonly contexts: readonly KeyContext[];

  constructor(contexts: readonly KeyContext[]) {
    this.contexts = contexts;
  }

  public isLiveIn(context: KeyContext): boolean {
    return this.contexts.includes(context);
  }

  public actionFor(stroke: KeyStroke): DeckAction | undefined {
    if (stroke.ctrl || stroke.alt || stroke.meta) return undefined;
    const position = PaneDigitBinding.DIGITS.indexOf(stroke.key) + 1;
    return position === 0 ? undefined : { kind: 'focus-pane', position };
  }
}

/** The table. First match wins, so order is the tie-break and the list below is the tie-break. */
export class DeckKeymap {
  private readonly entries: readonly KeyBinding[];

  constructor(entries: readonly KeyBinding[]) {
    this.entries = entries;
  }

  public get bindings(): readonly KeyBinding[] {
    return this.entries;
  }

  /** What this key means here, or `undefined` — which is the caller's cue to let it through. */
  public resolve(stroke: KeyStroke, context: KeyContext): DeckAction | undefined {
    for (const binding of this.entries) {
      if (!binding.isLiveIn(context)) continue;
      const action = binding.actionFor(stroke);
      if (action !== undefined) return action;
    }
    return undefined;
  }

  /** One group, for the shortcut sheet. Empty is a real answer and the sheet omits the heading. */
  public inSection(section: KeySection): readonly KeyBinding[] {
    return this.entries.filter((binding) => binding.section === section);
  }
}

const EVERYWHERE: readonly KeyContext[] = ['deck', 'text', 'terminal', 'palette'];

/** The deck's own keymap — SPEC §5.4's list, and nothing that is not on it. */
export function standardKeymap(): DeckKeymap {
  return new DeckKeymap([...globalBindings(), ...sessionBindings(), ...paletteBindings()]);
}

/** Live wherever focus is, or nearly — `Esc` stops at the terminal, and the header says why. */
function globalBindings(): readonly KeyBinding[] {
  return [
    new ChordBinding({
      label: 'Ctrl+K',
      description: 'Command palette — the way back out of a pane',
      section: 'global',
      contexts: EVERYWHERE,
      // `K` as well as `k`: with caps lock on, or with shift also held, the browser reports the
      // upper case. Both are the same intent and neither is bound to anything else.
      keys: ['k', 'K'],
      ctrl: true,
      action: { kind: 'toggle-palette' },
    }),
    new ChordBinding({
      label: 'Esc',
      description: 'Close the palette or this sheet; leave a text field',
      section: 'global',
      contexts: ['deck', 'text', 'palette'],
      keys: ['Escape'],
      ctrl: false,
      action: { kind: 'dismiss' },
    }),
    new ChordBinding({
      label: '?',
      description: 'This sheet',
      section: 'global',
      contexts: ['deck'],
      keys: ['?'],
      ctrl: false,
      action: { kind: 'toggle-shortcuts' },
    }),
  ];
}

/** The list, and the panes beside it. All of these are `deck`-only: they are single characters. */
function sessionBindings(): readonly KeyBinding[] {
  return [
    new ChordBinding({
      label: 'j  ↓',
      description: 'Next session',
      section: 'sessions',
      contexts: ['deck'],
      keys: ['j', 'ArrowDown'],
      ctrl: false,
      action: { kind: 'move-selection', delta: 1 },
    }),
    new ChordBinding({
      label: 'k  ↑',
      description: 'Previous session',
      section: 'sessions',
      contexts: ['deck'],
      keys: ['k', 'ArrowUp'],
      ctrl: false,
      action: { kind: 'move-selection', delta: -1 },
    }),
    new ChordBinding({
      label: '/',
      description: 'Filter the session list',
      section: 'sessions',
      contexts: ['deck'],
      keys: ['/'],
      ctrl: false,
      action: { kind: 'focus-search' },
    }),
    ...paneBindings(),
  ];
}

/**
 * The panes: `1`-`9` to reach one, `[` and `]` to move it.
 *
 * All `deck`-only, and that is D34 rather than an oversight — `Ctrl+K` is the ONE key taken from a
 * live pane, so rearranging happens from the deck and every bracket typed at a shell still reaches
 * the shell. `[` and `]` because they are unshifted, adjacent, and directional in the way the
 * digits already are.
 */
function paneBindings(): readonly KeyBinding[] {
  return [
    new PaneDigitBinding(['deck']),
    new ChordBinding({
      label: '[',
      description: 'Move the focused pane one place left',
      section: 'panes',
      contexts: ['deck'],
      keys: ['['],
      ctrl: false,
      action: { kind: 'move-pane', delta: -1 },
    }),
    new ChordBinding({
      label: ']',
      description: 'Move the focused pane one place right',
      section: 'panes',
      contexts: ['deck'],
      keys: [']'],
      ctrl: false,
      action: { kind: 'move-pane', delta: 1 },
    }),
  ];
}

/** Only while the palette is up — and deliberately no letters, because it has a text input. */
function paletteBindings(): readonly KeyBinding[] {
  return [
    new ChordBinding({
      label: '↓',
      description: 'Next result — j and k type here',
      section: 'palette',
      contexts: ['palette'],
      keys: ['ArrowDown'],
      ctrl: false,
      action: { kind: 'move-selection', delta: 1 },
    }),
    new ChordBinding({
      label: '↑',
      description: 'Previous result',
      section: 'palette',
      contexts: ['palette'],
      keys: ['ArrowUp'],
      ctrl: false,
      action: { kind: 'move-selection', delta: -1 },
    }),
    new ChordBinding({
      label: 'Enter',
      description: 'Run the selected command',
      section: 'palette',
      contexts: ['palette'],
      keys: ['Enter'],
      ctrl: false,
      action: { kind: 'run-selection' },
    }),
  ];
}

/**
 * The four facts about the focused element that decide the context.
 *
 * Four booleans and a tag name rather than an `Element`, so the rule below is assertable without a
 * DOM and the DOM half stays five lines long in app/ (CODING-STANDARDS §2 — the decision points
 * inward, the reading of the browser does not).
 */
export interface FocusProbe {
  /** Upper case, as the DOM reports it. `''` when nothing has focus. */
  readonly tagName: string;
  /** `isContentEditable`. A `div` can take typing too. */
  readonly editable: boolean;
  /** Inside a terminal pane's host element. */
  readonly inTerminal: boolean;
  /** The palette is open. A fact about the deck, not about the element — the palette is modal. */
  readonly paletteOpen: boolean;
}

const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT'];

/**
 * Where focus is. **The order of these four tests is the whole rule.**
 *
 * xterm takes its input through a hidden `textarea`, so a pane and a launch prompt look identical
 * to the tag-name test and only the terminal test separates them — put `TYPING_TAGS` first and
 * every pane becomes `text`, which silently un-binds `Ctrl+K` inside the panes it exists for. The
 * palette goes ahead of both because it is modal: while it is open its keys win wherever focus
 * actually sits, including the pane that had it a moment ago.
 */
export function keyContextFor(probe: FocusProbe): KeyContext {
  if (probe.paletteOpen) return 'palette';
  if (probe.inTerminal) return 'terminal';
  if (probe.editable || TYPING_TAGS.includes(probe.tagName)) return 'text';
  return 'deck';
}

/**
 * Where `move-selection` lands: one step, wrapping, out of a list of `count`.
 *
 * Shared by the session rows and the palette results because it is the same question twice, and
 * both of its edges are the kind that get written twice and disagree: `current === -1` means
 * nothing is selected yet, so the first `↓` must land on `0` rather than on `1`; and an empty list
 * has no index at all, which is `-1` rather than `0` so that a caller cannot select a row that is
 * not there.
 */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

// The keymap — P2-T5, contracts/keymap.ts.
//
// The assertions worth having here are not "Ctrl+K opens the palette". They are the four that say
// the deck does not eat keys it has no business eating: a prompt being typed into a session, a
// launch textarea, `Esc` in vim, and the palette's own input. Each of those is a one-line mistake
// in the table away, and none of them would fail a rendering test either — the deck would simply
// feel broken.
import { describe, expect, it } from 'vitest';
import {
  ChordBinding,
  DeckKeymap,
  PaneDigitBinding,
  keyContextFor,
  standardKeymap,
  stepIndex,
  type KeyContext,
  type KeyStroke,
} from '../../contracts/keymap.ts';

function stroke(key: string, modifiers: Partial<KeyStroke> = {}): KeyStroke {
  return { key, ctrl: false, alt: false, meta: false, ...modifiers };
}

const KEYMAP = standardKeymap();

describe('standardKeymap — what is live where', () => {
  it('opens the palette on Ctrl+K in every context, including inside a terminal pane', () => {
    const contexts: readonly KeyContext[] = ['deck', 'text', 'terminal', 'palette'];
    for (const context of contexts) {
      expect(KEYMAP.resolve(stroke('k', { ctrl: true }), context)).toEqual({
        kind: 'toggle-palette',
      });
    }
  });

  it('takes Ctrl+K with the upper case key too — caps lock, or shift also held', () => {
    expect(KEYMAP.resolve(stroke('K', { ctrl: true }), 'deck')).toEqual({ kind: 'toggle-palette' });
  });

  it('moves the selection on j, k and the arrows on the deck', () => {
    expect(KEYMAP.resolve(stroke('j'), 'deck')).toEqual({ kind: 'move-selection', delta: 1 });
    expect(KEYMAP.resolve(stroke('ArrowDown'), 'deck')).toEqual({
      kind: 'move-selection',
      delta: 1,
    });
    expect(KEYMAP.resolve(stroke('k'), 'deck')).toEqual({ kind: 'move-selection', delta: -1 });
    expect(KEYMAP.resolve(stroke('ArrowUp'), 'deck')).toEqual({
      kind: 'move-selection',
      delta: -1,
    });
  });

  it('binds / and ? on the deck', () => {
    expect(KEYMAP.resolve(stroke('/'), 'deck')).toEqual({ kind: 'focus-search' });
    expect(KEYMAP.resolve(stroke('?'), 'deck')).toEqual({ kind: 'toggle-shortcuts' });
  });

  it('jumps to a pane on 1 through 9, and 0 is not a pane', () => {
    expect(KEYMAP.resolve(stroke('1'), 'deck')).toEqual({ kind: 'focus-pane', position: 1 });
    expect(KEYMAP.resolve(stroke('9'), 'deck')).toEqual({ kind: 'focus-pane', position: 9 });
    expect(KEYMAP.resolve(stroke('0'), 'deck')).toBeUndefined();
  });
});

describe('standardKeymap — the keys the deck must NOT take', () => {
  // The whole point of the context column. Each of these is a real key someone is in the middle of
  // typing, and resolving any of them would swallow it.
  const typedInAField: readonly string[] = ['j', 'k', '/', '?', '1', '9', 'ArrowDown', 'ArrowUp'];

  it('leaves every single-character key alone while a text field has focus', () => {
    for (const key of typedInAField) {
      expect(KEYMAP.resolve(stroke(key), 'text')).toBeUndefined();
    }
  });

  it('leaves every single-character key alone while a terminal pane has focus', () => {
    for (const key of [...typedInAField, 'Enter']) {
      expect(KEYMAP.resolve(stroke(key), 'terminal')).toBeUndefined();
    }
  });

  it('never takes Esc from a terminal pane — it belongs to whatever is running in it', () => {
    expect(KEYMAP.resolve(stroke('Escape'), 'terminal')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('Escape'), 'deck')).toEqual({ kind: 'dismiss' });
    expect(KEYMAP.resolve(stroke('Escape'), 'text')).toEqual({ kind: 'dismiss' });
  });

  it('leaves j and k to the palette input, and binds the arrows there instead', () => {
    expect(KEYMAP.resolve(stroke('j'), 'palette')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('k'), 'palette')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('ArrowDown'), 'palette')).toEqual({
      kind: 'move-selection',
      delta: 1,
    });
    expect(KEYMAP.resolve(stroke('ArrowUp'), 'palette')).toEqual({
      kind: 'move-selection',
      delta: -1,
    });
  });

  it('binds Enter only in the palette — on the deck it is the focused row button’s own', () => {
    expect(KEYMAP.resolve(stroke('Enter'), 'palette')).toEqual({ kind: 'run-selection' });
    expect(KEYMAP.resolve(stroke('Enter'), 'deck')).toBeUndefined();
  });

  it('ignores Alt and Meta everywhere — those belong to Windows and to the browser', () => {
    expect(KEYMAP.resolve(stroke('j', { alt: true }), 'deck')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('k', { meta: true, ctrl: true }), 'deck')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('1', { alt: true }), 'deck')).toBeUndefined();
  });

  it('does not fire an unmodified binding when Ctrl is held', () => {
    expect(KEYMAP.resolve(stroke('j', { ctrl: true }), 'deck')).toBeUndefined();
    expect(KEYMAP.resolve(stroke('/', { ctrl: true }), 'deck')).toBeUndefined();
  });
});

describe('keyContextFor', () => {
  const nothingFocused = { tagName: '', editable: false, inTerminal: false, paletteOpen: false };

  it('is deck with nothing focused, and with a button focused', () => {
    expect(keyContextFor(nothingFocused)).toBe('deck');
    expect(keyContextFor({ ...nothingFocused, tagName: 'BUTTON' })).toBe('deck');
  });

  it('is text for the fields someone types into', () => {
    expect(keyContextFor({ ...nothingFocused, tagName: 'TEXTAREA' })).toBe('text');
    expect(keyContextFor({ ...nothingFocused, tagName: 'INPUT' })).toBe('text');
    expect(keyContextFor({ ...nothingFocused, tagName: 'SELECT' })).toBe('text');
    expect(keyContextFor({ ...nothingFocused, tagName: 'DIV', editable: true })).toBe('text');
  });

  // The ordering bug this file exists to prevent. xterm takes its input through a hidden textarea,
  // so a pane and a launch prompt are the same tag; test `text` first and every pane silently
  // becomes a text field, which un-binds Ctrl+K in exactly the place it is needed most.
  it('is terminal for xterm’s hidden textarea, not text', () => {
    expect(keyContextFor({ ...nothingFocused, tagName: 'TEXTAREA', inTerminal: true })).toBe(
      'terminal',
    );
  });

  it('is palette whenever the palette is open, wherever focus actually sits', () => {
    expect(keyContextFor({ ...nothingFocused, paletteOpen: true })).toBe('palette');
    expect(
      keyContextFor({ tagName: 'TEXTAREA', editable: false, inTerminal: true, paletteOpen: true }),
    ).toBe('palette');
  });
});

describe('DeckKeymap', () => {
  it('returns the first matching live binding, so order is the tie-break', () => {
    const first = new ChordBinding({
      label: 'x',
      description: 'first',
      section: 'global',
      contexts: ['deck'],
      keys: ['x'],
      ctrl: false,
      action: { kind: 'dismiss' },
    });
    const second = new ChordBinding({
      label: 'x',
      description: 'second',
      section: 'global',
      contexts: ['deck'],
      keys: ['x'],
      ctrl: false,
      action: { kind: 'focus-search' },
    });
    expect(new DeckKeymap([first, second]).resolve(stroke('x'), 'deck')).toEqual({
      kind: 'dismiss',
    });
  });

  it('skips a binding that is not live here even when it matches the key', () => {
    const digits = new PaneDigitBinding(['deck']);
    expect(digits.isLiveIn('terminal')).toBe(false);
    expect(new DeckKeymap([digits]).resolve(stroke('2'), 'terminal')).toBeUndefined();
  });

  it('groups the table for the sheet, and every binding lands in exactly one group', () => {
    const grouped = (['global', 'sessions', 'panes', 'palette'] as const).flatMap((section) =>
      KEYMAP.inSection(section),
    );
    expect(grouped).toHaveLength(KEYMAP.bindings.length);
  });

  it('gives every row of the sheet a label and a sentence', () => {
    for (const binding of KEYMAP.bindings) {
      expect(binding.label).not.toBe('');
      expect(binding.description).not.toBe('');
    }
  });
});

describe('stepIndex', () => {
  it('starts at the first from nothing selected, and at the last going backwards', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0);
    expect(stepIndex(-1, -1, 5)).toBe(4);
  });

  it('wraps at both ends', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(2, 1, 5)).toBe(3);
  });

  it('is -1 for an empty list rather than 0 — there is no row zero to select', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1);
    expect(stepIndex(3, -1, 0)).toBe(-1);
  });
});

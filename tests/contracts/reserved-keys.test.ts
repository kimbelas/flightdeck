// The `?` sheet's other half — P2-T5, contracts/reserved-keys.ts.
//
// There is no logic here to test, which is the point: these are RESEARCH.md E.2's findings as data,
// and what can go wrong is that the sheet renders a key with no explanation beside it, or that
// somebody "tidies" Ctrl+W out of the list because the deck does not handle it. Both are caught by
// asserting the shape and the one entry that matters most.
import { describe, expect, it } from 'vitest';
import {
  BROWSER_OWNED_KEYS,
  NATIVE_KEYS,
  TERMINAL_CLAIMED,
  type ReservedKey,
} from '../../contracts/reserved-keys.ts';

const ALL: readonly ReservedKey[] = [...BROWSER_OWNED_KEYS, ...NATIVE_KEYS, ...TERMINAL_CLAIMED];

describe('reserved keys', () => {
  it('gives every key a label and a sentence — a bare key on the sheet explains nothing', () => {
    for (const key of ALL) {
      expect(key.label).not.toBe('');
      expect(key.effect).not.toBe('');
    }
  });

  it('names no key twice, so the sheet cannot contradict itself', () => {
    const labels = ALL.map((key) => key.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // E.2's headline finding, and the first question anyone asks the sheet.
  it('still lists Ctrl+W as the browser’s — it closes an --app window and cannot be reclaimed', () => {
    const closer = BROWSER_OWNED_KEYS.find((key) => key.label === 'Ctrl+W');
    expect(closer?.effect).toContain('Closes the window');
  });

  it('says out loud that Ctrl+K is taken from a terminal pane', () => {
    expect(TERMINAL_CLAIMED.map((key) => key.label)).toEqual(['Ctrl+K']);
  });
});

// The diff is what the owner approves before anything is written (D13), so it has to be honest.
import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../../contracts/text-diff.ts';

describe('unifiedDiff', () => {
  it('is empty for identical text, which is how "nothing to do" is told apart from a no-op diff', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('marks additions with + and removals with -', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nc\n');

    expect(diff).toContain('-b');
    expect(diff).toContain('+c');
  });

  it('shows a pure append as additions only, with no removed lines', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nb\nc\n');

    expect(diff.split('\n').filter((line) => line.startsWith('-'))).toEqual([]);
    expect(diff).toContain('+c');
  });

  it('keeps context around a change and leaves distant lines out', () => {
    const before = Array.from({ length: 40 }, (unused, i) => `line ${String(i)}`).join('\n');
    const after = before.replace('line 20', 'CHANGED');

    const diff = unifiedDiff(before, after);

    expect(diff).toContain(' line 19');
    expect(diff).not.toContain(' line 5');
  });

  it('opens a hunk header per run of change rather than one for the whole file', () => {
    const before = Array.from({ length: 40 }, (unused, i) => `line ${String(i)}`).join('\n');
    const after = before.replace('line 2', 'X').replace('line 30', 'Y');

    expect(
      unifiedDiff(after, before)
        .split('\n')
        .filter((l) => l.startsWith('@@')),
    ).toHaveLength(2);
  });

  it('treats a CRLF line as different from the same line with LF, because it is', () => {
    // The reason JsonFormat exists. If this ever returned '' the G.13 bug would be invisible.
    expect(unifiedDiff('a\r\nb\r\n', 'a\nb\n')).not.toBe('');
  });
});

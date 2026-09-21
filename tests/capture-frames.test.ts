// The terminal-frame half of the scrubber — split out of `capture-fixtures.test.ts` in P4-T4.
//
// A separate file because the RULES are the inverse of the JSON ones and reading them next to
// each other invites applying the wrong one: a `.json` fixture has to keep its SHAPE, and a
// `.txt` frame has to keep its LENGTH, because every glyph advances the cursor one cell and the
// frame relies on autowrap (DECISIONS.md D42, RESEARCH.md G.34). The parent file reached its
// 250-line limit, and this was the seam with a story of its own.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper script, no type declarations by design.
import { scrubFrame } from '../scripts/capture-fixtures.mjs';

const scrubTerminalFrame = scrubFrame as (raw: string) => string;
describe('capture-fixtures scrubFrame', () => {
  const ESC = '\u001b';
  // eslint-disable-next-line no-control-regex -- see scripts/capture-fixtures.mjs.
  const SEQUENCES = /\u001b\][^\u0007\u001b]*\u0007|\u001b\[[0-?]*[ -/]*[@-~]/gu;

  it('replaces every letter and digit', () => {
    const scrubbed = scrubTerminalFrame(`${ESC}[m Claude Code v2.1.267`);

    expect(scrubbed).not.toContain('Claude');
    expect(scrubbed).not.toContain('267');
  });

  it('keeps the frame EXACTLY as long, because length is what the emulator reads', () => {
    const raw = `${ESC}[38;5;114m okay ${ESC}[m then a much longer run of text${ESC}[K`;

    expect(scrubTerminalFrame(raw)).toHaveLength(raw.length);
  });

  it('passes every escape sequence through byte for byte', () => {
    const raw = `${ESC}[2J${ESC}[H${ESC}[38;2;215;119;87mhi${ESC}[162X${ESC}]0;title\u0007${ESC}[K`;
    const sequences = (text: string): readonly string[] => text.match(SEQUENCES) ?? [];

    expect(sequences(scrubTerminalFrame(raw))).toEqual(sequences(raw));
  });

  it('keeps CR, LF and the chrome glyphs, which are structure rather than identity', () => {
    const raw = `${ESC}[K ─█▸ · abc\r\n${ESC}[K`;

    const scrubbed = scrubTerminalFrame(raw);

    expect(scrubbed).toContain('─█▸');
    expect(scrubbed).toContain('·');
    expect(scrubbed).toContain('\r\n');
  });

  it('keeps a path looking like a path — same separators, same depth', () => {
    const raw = `${ESC}[mC:\\Users\\belas\\.claude-365\\projects${ESC}[K`;

    const scrubbed = scrubTerminalFrame(raw);

    expect(scrubbed).not.toContain('belas');
    expect(scrubbed.split('\\')).toHaveLength(raw.split('\\').length);
  });

  it('preserves the class of each character, so a uuid stays uuid-shaped', () => {
    const raw = `${ESC}[mc6dce4f0-8209-4305-9d99-d1fef3a33816${ESC}[K`;

    expect(scrubTerminalFrame(raw)).toMatch(
      /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/u,
    );
  });

  it('does not read the letters at all — two frames differing only in words scrub identically', () => {
    // The disclosure property, as a test. The filler is keyed on POSITION and LENGTH, never on the
    // word, so there is nothing for a dictionary attack to confirm a guess against — which a
    // per-word hash of a four-thousand-word screen would hand over for one sha256 per candidate.
    const left = `${ESC}[mhello world${ESC}[K`;
    const right = `${ESC}[mabcde fghij${ESC}[K`;

    expect(scrubTerminalFrame(left)).toBe(scrubTerminalFrame(right));
  });

  it('is deterministic, so a re-scrub of the same capture is a zero-line diff', () => {
    const raw = `${ESC}[mthe same input twice${ESC}[K`;

    expect(scrubTerminalFrame(raw)).toBe(scrubTerminalFrame(raw));
  });

  it('refuses a capture with no escape sequence — that is not a terminal frame', () => {
    expect(() => scrubTerminalFrame('just some text\n')).toThrow(/not a terminal frame/u);
  });

  it('refuses a non-ASCII letter rather than changing the cell width of a wide glyph', () => {
    expect(() => scrubTerminalFrame(`${ESC}[m café ${ESC}[K`)).toThrow(/non-ASCII letter/u);
  });
});

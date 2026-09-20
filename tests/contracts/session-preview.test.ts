// The preview wire shape — P5a-T4, SEC-UI-2's boundary on the deck's side.
//
// The caps are re-applied by the parser rather than trusted from core, and that is what these
// assert: a deck that took core's word for the length of a model-written line would be trusting a
// socket. Same rule as `parseSessionDetail` re-parsing the job state it was handed.
import { describe, expect, it } from 'vitest';
import {
  condense,
  MAX_PREVIEW_COLUMNS,
  MAX_PREVIEW_LINES,
  parseSessionPreview,
} from '../../contracts/session-preview.ts';

const BODY = {
  sessionId: '4a2f9c11-0b7e-4b25-9d0a-7c1f2e3d4b5a',
  at: 1_789_000_000_000,
  source: 'logs',
  lines: ['a row', 'another row'],
  reason: undefined,
};

describe('parseSessionPreview', () => {
  it('reads a whole preview', () => {
    expect(parseSessionPreview(BODY)).toEqual({ ...BODY, reason: undefined });
  });

  it('refuses a body with no session id — it could not say which row it belongs to', () => {
    expect(parseSessionPreview({ ...BODY, sessionId: '' })).toBeUndefined();
    expect(parseSessionPreview({ ...BODY, sessionId: 7 })).toBeUndefined();
    expect(parseSessionPreview(undefined)).toBeUndefined();
    expect(parseSessionPreview([BODY])).toBeUndefined();
  });

  it('falls back to `none` for a source outside the vocabulary', () => {
    expect(parseSessionPreview({ ...BODY, source: 'screenshot' })?.source).toBe('none');
  });

  it('drops a reason outside the vocabulary rather than passing the string through', () => {
    // The field exists so the DECK owns the wording; a free string here would be a way for
    // model-written text to reach the page through a field nobody screens.
    expect(parseSessionPreview({ ...BODY, reason: 'the daemon exploded' })?.reason).toBeUndefined();
  });

  it('keeps a reason that is in the vocabulary', () => {
    expect(parseSessionPreview({ ...BODY, reason: 'daemon_down' })?.reason).toBe('daemon_down');
  });

  it('caps how many lines it will accept, whatever core sent', () => {
    const lines = Array.from({ length: MAX_PREVIEW_LINES + 40 }, () => 'row');

    expect(parseSessionPreview({ ...BODY, lines })?.lines).toHaveLength(MAX_PREVIEW_LINES);
  });

  it('caps how long a line may be', () => {
    const lines = ['x'.repeat(MAX_PREVIEW_COLUMNS + 500)];

    expect(parseSessionPreview({ ...BODY, lines })?.lines[0]).toHaveLength(MAX_PREVIEW_COLUMNS);
  });

  it('drops anything in `lines` that is not a string', () => {
    expect(parseSessionPreview({ ...BODY, lines: ['row', 3, null, { row: 1 }] })?.lines).toEqual([
      'row',
    ]);
  });

  it('answers an empty preview rather than refusing when there is nothing to show', () => {
    const preview = parseSessionPreview({ sessionId: BODY.sessionId });

    expect(preview?.source).toBe('none');
    expect(preview?.lines).toEqual([]);
    expect(preview?.at).toBe(0);
  });
});

describe('condense', () => {
  it('drops the trailing padding a fixed-width screen leaves on every row', () => {
    expect(condense(['text' + ' '.repeat(196)])).toEqual(['text']);
  });

  it('drops the blank band above and below', () => {
    expect(condense(['', '', 'text', '', ''])).toEqual(['text']);
  });

  it('collapses an interior run of blanks to one', () => {
    // `claude logs` renders a FIXED 50 rows, so a session that has printed eight lines still
    // sends fifty. Forty blank rows are a fact about the frame's height, not about the session.
    expect(condense(['top', '', '', '', '', 'bottom'])).toEqual(['top', '', 'bottom']);
  });

  it('keeps one blank as a paragraph break, because the screen meant it', () => {
    expect(condense(['top', '', 'bottom'])).toEqual(['top', '', 'bottom']);
  });

  it('keeps the LAST lines when there are more than fit — a screen ends at the bottom', () => {
    const rows = Array.from({ length: MAX_PREVIEW_LINES + 10 }, (unused, i) => `row ${String(i)}`);

    const kept = condense(rows);

    expect(kept).toHaveLength(MAX_PREVIEW_LINES);
    expect(kept.at(-1)).toBe(`row ${String(MAX_PREVIEW_LINES + 9)}`);
  });

  it('answers nothing for a screen that is entirely blank', () => {
    expect(condense(Array.from({ length: 50 }, () => ''))).toEqual([]);
  });
});

// RESEARCH.md G.13 — the whole-file rewrite that a summary would have hidden.
//
// `.claude-365\settings.json` is LF and `.claude-isg\settings.json` is CRLF on the owner's
// machine. `JSON.stringify` only ever emits LF, so re-printing the isg file rewrote all 88 of its
// lines while the change was five appended hook entries. Every test here is that bug.
import { describe, expect, it } from 'vitest';
import { JsonFormat } from '../../../core/shared/json-format.ts';

describe('JsonFormat', () => {
  it('re-prints a CRLF file as CRLF', () => {
    const source = '{\r\n  "a": 1\r\n}\r\n';

    expect(JsonFormat.of(source).print({ a: 1 })).toBe(source);
  });

  it('re-prints an LF file as LF', () => {
    const source = '{\n  "a": 1\n}\n';

    expect(JsonFormat.of(source).print({ a: 1 })).toBe(source);
  });

  it('round-trips both config dirs’ conventions unchanged when nothing was edited', () => {
    for (const eol of ['\n', '\r\n']) {
      const source = `{${eol}  "model": "opus",${eol}  "hooks": {}${eol}}${eol}`;

      const printed = JsonFormat.of(source).print(JSON.parse(source));

      expect(printed).toBe(source);
    }
  });

  it('keeps a four-space file at four spaces', () => {
    const source = '{\n    "a": 1\n}\n';

    expect(JsonFormat.of(source).print({ a: 1 })).toBe(source);
  });

  it('keeps a tab-indented file on tabs', () => {
    const source = '{\n\t"a": 1\n}\n';

    expect(JsonFormat.of(source).print({ a: 1 })).toBe(source);
  });

  it('does not invent a trailing newline the original did not have', () => {
    expect(JsonFormat.of('{\n  "a": 1\n}').print({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('defaults to two spaces when the source has no indented line to learn from', () => {
    expect(JsonFormat.of('{}').print({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

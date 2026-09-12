// Re-prints JSON the way the file it came from was written (P1-T11).
//
// Found by running it, not by a test (RESEARCH.md G.13). `JSON.stringify(value, undefined, 2)` is
// the obvious way to write settings.json back, and on this machine it rewrote **every line** of
// `.claude-isg\settings.json` while leaving `.claude-365\settings.json` alone: the two config dirs
// disagree about line endings — isg is CRLF, 365 is LF — and `stringify` always emits LF.
//
// A diff that claims to be additive and is in fact a whole-file rewrite is the exact failure
// SEC-FS-3 and D13 exist to prevent, and it would have been invisible to anyone reading a summary
// instead of the diff. It is also the same trap F.3.7 hit with statusline.py, in a second file, so
// it is now a class with a name rather than a line of defensive code in one caller.
//
// It reproduces the ending, the indent and whether the file ended with a newline. It does NOT
// reproduce key order beyond what `JSON.parse` preserves (insertion order, which is what the
// parse gives back) or anything else about the original text — a file that was hand-formatted in
// some other way still gets re-printed, and the diff still shows it.

export class JsonFormat {
  private readonly eol: string;
  private readonly indent: number | string;
  private readonly trailingNewline: boolean;

  private constructor(eol: string, indent: number | string, trailingNewline: boolean) {
    this.eol = eol;
    this.indent = indent;
    this.trailingNewline = trailingNewline;
  }

  /** Reads the conventions off the original text. An empty or one-line file gets the defaults. */
  public static of(source: string): JsonFormat {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    return new JsonFormat(eol, indentOf(source), source.endsWith('\n'));
  }

  public print(value: unknown): string {
    const text = JSON.stringify(value, undefined, this.indent);
    // stringify only ever emits `\n`, so splitting on it is exact rather than a guess.
    const body = text.split('\n').join(this.eol);
    return this.trailingNewline ? `${body}${this.eol}` : body;
  }
}

/**
 * The whitespace before the first indented line — a count for spaces, the text itself for tabs.
 *
 * Two is the default because it is what both config dirs use and what `stringify` would have done
 * anyway; the point of detecting is the file that does something else.
 */
function indentOf(source: string): number | string {
  const match = /\r?\n([ \t]+)\S/.exec(source);
  const whitespace = match?.[1];
  if (whitespace === undefined) return 2;
  return whitespace.startsWith('\t') ? '\t' : whitespace.length;
}

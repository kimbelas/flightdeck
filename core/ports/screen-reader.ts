// Replaying a terminal frame and reading the screen it leaves — P5a-T4, SEC-UI-2.
//
// A port for the reason `ProcessRunner` is one, and for one more. The ordinary reason: the adapter
// carries a library and a real terminal emulator, and no unit test of "which source answered a
// preview" should have to own one. The extra reason is the control — SEC-UI-2 says "ANSI is
// rendered by xterm.js, never by hand", so the emulator is not an implementation detail somebody
// may swap for a regex when the dependency looks heavy. Naming it as a port is what makes that
// visible: there is one adapter, it is xterm, and replacing it is a decision with a paragraph
// rather than an edit.
//
// **It takes a frame and a size, never a session or a path.** Nothing here spawns, opens or knows
// what it is replaying. That keeps the one piece of this task that handles 330 KB of untrusted
// escape sequences (RESEARCH.md F.2.5) a pure function of its input, which is the only shape a
// thing like that should have.

export interface ScreenSize {
  readonly columns: number;
  readonly rows: number;
}

/**
 * `claude logs` renders at exactly this, and it is measured rather than configured — G.34.
 *
 * Checked three ways, because the obvious assumption is that a program writing to a pipe falls back
 * to 80 columns and it does not: a piped `claude logs` renders 200 wide, `COLUMNS=120 LINES=30`
 * does not move it, and the P0 capture made a fortnight earlier is 200 wide too. The highest cursor
 * row any of the three addresses is 47 and one repaint is 50 rows.
 *
 * The size matters and cannot be approximated. The frame relies on AUTOWRAP — its 200-character
 * rules are written with no newline after them and wrap onto the next row — so a screen one column
 * narrower reflows every line below the first one and the preview becomes nonsense that still
 * looks like a screen.
 */
export const CLAUDE_LOGS_FRAME: ScreenSize = { columns: 200, rows: 50 };

export interface ScreenReader {
  /**
   * The rows left on a fresh screen of `size` after `frame` has been replayed onto it.
   *
   * Exactly `size.rows` strings, top to bottom, with trailing padding intact — trimming is the
   * caller's, because `condense` does it for both preview sources at once and a reader that
   * trimmed here would make the two answers differ in their whitespace.
   *
   * Async because writing to a terminal is: the emulator parses in chunks and the buffer is only
   * settled once it says so, and reading it early yields a half-painted screen that no test on
   * this machine would ever catch.
   *
   * @throws never — a frame is untrusted input (SEC-UI-2), and the honest answer to one the
   * emulator cannot make sense of is a blank screen rather than a 500.
   */
  read(frame: string, size: ScreenSize): Promise<readonly string[]>;
}

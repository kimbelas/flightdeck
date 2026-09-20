// The emulator SEC-UI-2 names, with no DOM — P5a-T4.
//
// `@xterm/headless` is the same parser `@xterm/xterm` runs in a pane, minus the renderer. That is
// the whole reason it is here rather than a hand-rolled one: the frame uses six CSI finals
// (`m K H X C J` — measured, G.34) and a naive reader of those six is about forty lines, but it
// would be wrong about the seventh the day Claude Code emits one, and wrong SILENTLY, because a
// screen assembled from a misparsed frame still looks like a screen.
//
// **The flattening happens in core, not in the browser.** A preview is one screen of text, ~1.8 KB;
// the frame it came from is 330 KB. Sending the frame to the deck and rendering it in a hidden
// xterm would put a third of a megabyte on the wire per preview and hand the page the untrusted
// escape sequences (SEC-UI-2's "displayed, never interpreted" is easiest to keep when the thing
// that could be interpreted never arrives). 110 ms to replay the whole 330 KB capture, measured.
//
// **`scrollback: 0` is deliberate.** The frame repaints in place — it homes the cursor and paints
// over what is there, 105 times in the P0 capture — so nothing that matters ever scrolls off, and a
// scrollback buffer would only be somewhere for an adversarial frame to make core hold megabytes.
// The preview is the VIEWPORT, which is what "the last redraw wins" means in practice.
//
// The package is CommonJS, so it arrives as a default import rather than a named one, and
// `headless.Terminal` is used at its call sites rather than destructured: a `const { Terminal }`
// is a PascalCase VARIABLE, which the naming rule forbids and should — the exception is for types
// and classes declared here, not for a binding that happens to hold one.
import headless from '@xterm/headless';
import type { Logger } from '../../ports/logger.ts';
import type { ScreenReader, ScreenSize } from '../../ports/screen-reader.ts';

type HeadlessTerminal = InstanceType<typeof headless.Terminal>;

export class HeadlessScreenReader implements ScreenReader {
  private readonly logger: Logger;

  /**
   * @param logger where a blank screen says why it was blank. Required, and the reason is a bug
   * this class shipped with for ten minutes: `terminal.buffer` is PROPOSED API in `@xterm/headless`
   * 6.0.0 and throws without `allowProposedApi`, the catch below turned that into fifty empty rows,
   * and the preview rendered as an empty box with no error anywhere (RESEARCH.md G.36). A reader
   * that fails soft has to be a reader that says so, or the soft failure is the product.
   */
  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * @throws never — see the port. A frame that throws the emulator yields a blank screen.
   *
   * **The constructor is inside the `try`, and that is not tidiness.** `new Terminal` validates its
   * options and throws on a size it will not accept, so a version of this with the construction
   * above the `try` broke the port's promise for one input — found by the test that asserts the
   * warning is logged, which could not make the warning happen.
   */
  public async read(frame: string, size: ScreenSize): Promise<readonly string[]> {
    // xterm does NOT refuse a screen of zero or negative size — it constructs one and hands back
    // rows that are all empty, which is the failure this class must never make silently. So the
    // size is checked here rather than left to the library (RESEARCH.md G.36).
    if (size.columns < 1 || size.rows < 1) {
      this.logger.warn('screen_read_failed', { bytes: frame.length, reason: 'empty screen' });
      return blank(Math.max(0, size.rows));
    }
    let terminal: HeadlessTerminal | undefined;
    try {
      terminal = new headless.Terminal({
        cols: size.columns,
        rows: size.rows,
        scrollback: 0,
        // `terminal.buffer` is behind this flag. Reading the screen IS this class's whole job, so
        // the flag is not optional and its absence is not a degraded mode — see the constructor.
        allowProposedApi: true,
      });
      await write(terminal, frame);
      return rowsOf(terminal, size.rows);
    } catch (error: unknown) {
      this.logger.warn('screen_read_failed', {
        bytes: frame.length,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return blank(size.rows);
    } finally {
      terminal?.dispose();
    }
  }
}

/**
 * Writes the frame and waits for the emulator to have parsed all of it.
 *
 * The callback is the only honest signal. `write` queues, and reading the buffer straight after it
 * returns gives whatever had been parsed by then — on a 330 KB frame that is most of a screen, and
 * "most of a screen" is the failure that passes every test on a fast machine and shows up as a
 * half-painted preview on a slow one.
 */
function write(terminal: HeadlessTerminal, frame: string): Promise<void> {
  return new Promise<void>((resolve) => {
    terminal.write(frame, resolve);
  });
}

/** The viewport, top to bottom, with the padding a fixed-height frame leaves still on it. */
function rowsOf(terminal: HeadlessTerminal, rows: number): readonly string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < rows; y += 1) {
    const line = buffer.getLine(buffer.viewportY + y);
    lines.push(line === undefined ? '' : line.translateToString(true));
  }
  return lines;
}

function blank(rows: number): readonly string[] {
  return Array.from({ length: rows }, () => '');
}

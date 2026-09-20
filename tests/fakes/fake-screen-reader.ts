// An emulator that is not one — the fake for `ScreenReader` (CODING-STANDARDS §10.1).
//
// It splits on newlines and pads to the screen, which is the WRONG answer for a real frame and is
// exactly why it is useful here: a test of `PreviewReader` is about which source answered, and a
// fake that emulated properly would make every one of those tests also a test of xterm. The real
// flattening is proven once, against the real capture, in
// tests/core/adapters/headless-screen-reader.test.ts.
import type { ScreenReader, ScreenSize } from '../../core/ports/screen-reader.ts';

export class FakeScreenReader implements ScreenReader {
  /** Every frame handed over, so a test can assert what was replayed and at what size. */
  public readonly frames: { frame: string; size: ScreenSize }[] = [];

  public read(frame: string, size: ScreenSize): Promise<readonly string[]> {
    this.frames.push({ frame, size });
    const rows = frame.split('\n').slice(0, size.rows);
    while (rows.length < size.rows) rows.push('');
    return Promise.resolve(rows);
  }
}

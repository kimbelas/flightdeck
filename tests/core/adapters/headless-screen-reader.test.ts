// The emulator, against the real thing — P5a-T4.
//
// This is the one test in the task that runs the 330 KB capture through the real library, and the
// claim it exists to check is RESEARCH.md F.2.5's: `claude logs` returns a terminal frame, not
// text, and **a naive tail of it is garbage**. That sentence is asserted here rather than quoted —
// the naive tail is computed and compared against the screen, so a build where the emulator
// quietly stopped running would fail on the difference.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HeadlessScreenReader } from '../../../core/adapters/xterm/headless-screen-reader.ts';
import { CLAUDE_LOGS_FRAME } from '../../../core/ports/screen-reader.ts';
import { condense } from '../../../contracts/session-preview.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'logs');
const FRAME = readFileSync(join(FIXTURES, 'logs-blocked.txt'), 'utf8');

function read(frame: string): Promise<readonly string[]> {
  return new HeadlessScreenReader(new FakeLogger()).read(frame, CLAUDE_LOGS_FRAME);
}

describe('HeadlessScreenReader', () => {
  it('answers one row per line of the screen, however big the frame was', async () => {
    expect(await read(FRAME)).toHaveLength(CLAUDE_LOGS_FRAME.rows);
  });

  it('leaves no escape sequence anywhere in the answer', async () => {
    const rows = await read(FRAME);

    // The frame carries 10 483 of them (F.2.5). A single one surviving would reach a React text
    // node as literal `\u001b[38;2;…m`, which is what a preview must never show (SEC-UI-2).
    expect(rows.join('\n')).not.toContain('\u001b');
  });

  it('answers the LAST redraw, not a concatenation of all 105 of them', async () => {
    const lines = condense(await read(FRAME));

    // 330 046 bytes in, under 2 KB out. A reader that appended redraws instead of painting over
    // them would be tens of kilobytes here, and would still look like a screen.
    expect(lines.join('\n').length).toBeLessThan(2048);
  });

  it('is not what a naive tail of the frame produces — F.2.5, asserted rather than quoted', async () => {
    const screen = condense(await read(FRAME));
    const naive = condense(
      // eslint-disable-next-line no-control-regex -- stripping ESC is the naive tail being modelled.
      FRAME.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
        .split(/\r?\n/)
        .slice(-CLAUDE_LOGS_FRAME.rows),
    );

    expect(naive).not.toEqual(screen);
  });

  it('keeps the chrome that makes a screen recognisable as one', async () => {
    const screen = (await read(FRAME)).join('\n');

    // Box drawing and the status glyphs are structure, and the scrubber keeps them for this
    // reason: a preview a person cannot recognise as a Claude Code screen is not a preview.
    expect(screen).toContain('─');
    expect(screen).toContain('█');
  });

  it('never silently answers a blank screen for a real frame', async () => {
    // The regression this pins: `terminal.buffer` is proposed API, the catch below turned its
    // refusal into fifty empty rows, and nothing else in the suite would have noticed. Removing
    // `allowProposedApi` fails here (RESEARCH.md G.36).
    expect((await read(FRAME)).join('').trim()).not.toBe('');
  });

  it('answers a blank screen for a frame it cannot make sense of, rather than raising', async () => {
    expect(await read('\u001b[999;999H\u001b[?\u0000\u001b')).toHaveLength(CLAUDE_LOGS_FRAME.rows);
  });

  it('answers a blank screen for an empty frame', async () => {
    expect((await read('')).join('')).toBe('');
  });

  it('refuses a screen of no size, which xterm itself accepts and renders empty', async () => {
    // The reason this assertion exists: a blank screen is this class's failure mode and it is
    // indistinguishable from a quiet session, so every path to one has to say so. xterm accepts
    // `cols: 0` without complaint and returns rows that are all empty (RESEARCH.md G.36).
    const logger = new FakeLogger();

    const rows = await new HeadlessScreenReader(logger).read(FRAME, { columns: 0, rows: 50 });

    expect(rows.join('')).toBe('');
    expect(logger.logged('screen_read_failed')).toBe(true);
  });
});

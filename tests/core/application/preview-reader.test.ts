// Which source answers a preview, and why — P5a-T4.
//
// Every test here is about the ROUTING and none is about the emulator: the frame flattening is
// proven against the real 330 KB capture next door, and a fake screen reader keeps these about the
// decision. The decision is the part with a measurement behind it — a `claude logs` against a dead
// daemon takes 1.7-2.5 s to fail (RESEARCH.md G.34), so "do not spawn it" is worth testing as a
// behaviour rather than as an optimisation nobody checks.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { PreviewReader } from '../../../core/application/preview-reader.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessProbe } from '../../fakes/fake-process-probe.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeRosterSource, rosterView } from '../../fakes/fake-roster-source.ts';
import { FakeScreenReader } from '../../fakes/fake-screen-reader.ts';
import { FakeTranscriptFile } from '../../fakes/fake-transcript-file.ts';

const HOME = 'C:\\home';
const CONFIG = `${HOME}\\.claude-365`;
const TRANSCRIPT = `${CONFIG}\\projects\\a-slug\\4a2f9c11-0b7e-4b25-9d0a-7c1f2e3d4b5a.jsonl`;
const SUPERVISOR = 4242;

const REF: SessionRef = {
  sessionId: '4a2f9c11-0b7e-4b25-9d0a-7c1f2e3d4b5a',
  shortId: '4a2f9c11',
  subscription: '365',
};

/** A tool record, which is the trail's most ordinary row. */
function toolLine(tool: string, at: number): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    message: { content: [{ type: 'tool_use', name: tool }] },
  });
}

interface Harness {
  readonly reader: PreviewReader;
  readonly runner: FakeProcessRunner;
  readonly roster: FakeRosterSource;
  readonly probe: FakeProcessProbe;
  readonly screen: FakeScreenReader;
  readonly file: FakeTranscriptFile;
  readonly logger: FakeLogger;
}

interface Options {
  readonly executable?: string;
  readonly transcriptPath?: string | undefined;
  readonly supervisorAlive?: boolean;
  readonly roster?: boolean;
}

function build(options: Options = {}): Harness {
  const runner = new FakeProcessRunner();
  const roster = new FakeRosterSource();
  if (options.roster !== false) roster.willReturn('365', rosterView({ supervisorPid: SUPERVISOR }));
  const probe = new FakeProcessProbe();
  if (options.supervisorAlive !== false) probe.willBeAlive(SUPERVISOR);
  const screen = new FakeScreenReader();
  const file = new FakeTranscriptFile();
  const logger = new FakeLogger();
  const path = 'transcriptPath' in options ? options.transcriptPath : TRANSCRIPT;
  const reader = new PreviewReader({
    install: new ClaudeInstall(HOME, options.executable ?? 'C:\\claude.exe'),
    runner,
    roster,
    probe,
    screen,
    transcripts: { pathOf: () => path },
    file,
    policy: new ReadPolicy([CONFIG, `${HOME}\\.claude-isg`]),
    clock: new FakeClock(),
    logger,
  });
  return { reader, runner, roster, probe, screen, file, logger };
}

describe('PreviewReader', () => {
  describe('with the daemon up', () => {
    it('runs `logs <shortId>` and answers the screen it replayed', async () => {
      const harness = build();
      harness.runner.willReturn({ stdout: 'first row\nsecond row' });

      const preview = await harness.reader.read(REF);

      expect(harness.runner.requests[0]?.args).toEqual(['logs', '4a2f9c11']);
      expect(preview.source).toBe('logs');
      expect(preview.lines).toEqual(['first row', 'second row']);
    });

    it('replays at the size `claude logs` renders at — 200x50, measured (G.34)', async () => {
      const harness = build();
      harness.runner.willReturn({ stdout: 'a screen' });

      await harness.reader.read(REF);

      expect(harness.screen.frames[0]?.size).toEqual({ columns: 200, rows: 50 });
    });

    it('runs against the subscription the ref named', async () => {
      const harness = build();
      harness.runner.willReturn({ stdout: 'a screen' });

      await harness.reader.read(REF);

      expect(harness.runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toBe(CONFIG);
    });

    it('carries no reason — nothing about the answer that was asked for needs explaining', async () => {
      const harness = build();
      harness.runner.willReturn({ stdout: 'a screen' });

      expect((await harness.reader.read(REF)).reason).toBeUndefined();
    });
  });

  describe('with the daemon down', () => {
    it('does not spawn `claude logs` at all when the roster names a dead supervisor', async () => {
      const harness = build({ supervisorAlive: false });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);

      const preview = await harness.reader.read(REF);

      // The whole point of the roster check: a doomed spawn costs 1.7-2.5 s (G.34).
      expect(harness.runner.requests).toEqual([]);
      expect(harness.probe.asked).toEqual([SUPERVISOR]);
      expect(preview.source).toBe('transcript');
      expect(preview.reason).toBe('daemon_down');
    });

    it('treats a subscription with no roster at all as down', async () => {
      const harness = build({ roster: false });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);

      expect((await harness.reader.read(REF)).reason).toBe('daemon_down');
      expect(harness.runner.requests).toEqual([]);
    });

    it('re-reads the roster every time, so a daemon that came back is noticed', async () => {
      const harness = build();
      harness.runner.willReturn({ stdout: 'a screen' });

      await harness.reader.read(REF);
      await harness.reader.read(REF);

      expect(harness.roster.reads).toEqual(['365', '365']);
    });
  });

  describe('when `claude logs` fails anyway', () => {
    it('falls back to the transcript — the roster is a cache, not an oracle', async () => {
      const harness = build();
      harness.runner.willReturn({ code: 1, stderr: "Couldn't read logs — connect ENOENT" });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);

      const preview = await harness.reader.read(REF);

      expect(harness.runner.requests).toHaveLength(1);
      expect(preview.source).toBe('transcript');
      expect(preview.reason).toBe('logs_failed');
    });

    it('treats an EMPTY stdout at exit 0 as no screen', async () => {
      const harness = build();
      harness.runner.willReturn({ code: 0, stdout: '' });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);

      // The frame always opens by clearing and painting fifty rows, so nothing is the one thing a
      // working `logs` cannot return — and a blank box would be worse than the trail.
      expect((await harness.reader.read(REF)).source).toBe('transcript');
    });

    it('treats a timeout as no screen', async () => {
      const harness = build();
      harness.runner.willReturn({ code: 0, stdout: 'half a s', timedOut: true });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);

      expect((await harness.reader.read(REF)).source).toBe('transcript');
    });

    it('says so in the log, since nothing else records that the spawn was wasted', async () => {
      const harness = build();
      harness.runner.willReturn({ code: 1 });

      await harness.reader.read(REF);

      expect(harness.logger.logged('preview_logs_unavailable')).toBe(true);
    });
  });

  describe('with nothing to show', () => {
    it('answers `none` and `no_claude` when Claude Code is not installed', async () => {
      const harness = build({ executable: '' });

      const preview = await harness.reader.read(REF);

      expect(harness.runner.requests).toEqual([]);
      expect(preview.source).toBe('none');
      expect(preview.reason).toBe('no_claude');
    });

    it('answers `none` and keeps the daemon reason when no feed has named a transcript', async () => {
      const harness = build({ supervisorAlive: false, transcriptPath: undefined });

      const preview = await harness.reader.read(REF);

      // The reason the deck SHOWS is why there is no screen, and that stays true however the
      // fallback goes. An earlier draft let the fallback overwrite it, and a machine with no
      // `claude.exe` reported "no transcript" — burying the only actionable fact.
      expect(preview.source).toBe('none');
      expect(preview.reason).toBe('daemon_down');
      expect(preview.lines).toEqual([]);
    });

    it('answers `none` but keeps the reason when the file named cannot be read', async () => {
      const harness = build({ supervisorAlive: false });
      harness.file.append(TRANSCRIPT, `${toolLine('Bash', 0)}\n`);
      harness.file.makeUnreadable(TRANSCRIPT);

      const preview = await harness.reader.read(REF);

      expect(preview.source).toBe('none');
      expect(preview.reason).toBe('daemon_down');
    });

    it('answers `none` when the transcript holds no record it reads', async () => {
      const harness = build({ supervisorAlive: false });
      harness.file.append(TRANSCRIPT, `${JSON.stringify({ type: 'attachment' })}\n`);

      const preview = await harness.reader.read(REF);

      // The 95 % of a transcript this build never reads. An empty trail is an honest answer.
      expect(preview.source).toBe('none');
      expect(preview.lines).toEqual([]);
    });

    it('never opens a path `ReadPolicy` refuses, however it got into the registry', async () => {
      const harness = build({
        supervisorAlive: false,
        transcriptPath: `${CONFIG}\\daemon\\control.key`,
      });

      const preview = await harness.reader.read(REF);

      expect(preview.source).toBe('none');
      expect(harness.file.reads).toBe(0);
      expect(harness.logger.logged('preview_transcript_refused')).toBe(true);
    });
  });

  it('always answers the session it was asked about, whichever source replied', async () => {
    const harness = build({ supervisorAlive: false, transcriptPath: undefined });

    expect((await harness.reader.read(REF)).sessionId).toBe(REF.sessionId);
  });
});

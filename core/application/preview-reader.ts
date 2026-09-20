// What a session shows when it cannot show a terminal — P5a-T4, SPEC §5.3.
//
// **Who this is for changed, and the change made it more useful rather than less.** SPEC §5.3 gave
// previews to the panes a WebGL context budget had no renderer for. D40 deleted that budget, so
// that set is empty — but the set this serves was never empty and never can be: an INTERACTIVE
// session cannot be attached at all (SPEC §5.2, F.2.6), so for those a preview is not a cheaper
// terminal, it is the only way to see what the session is doing. A stopped background session is
// the same case for a different reason.
//
// **Two sources, and they are different kinds of answer.** `claude logs` gives the SCREEN — what
// that session's terminal looks like right now, replayed through an emulator because it arrives as
// a 200x50 frame and not as text (F.2.5). The transcript gives a TRAIL — what the session did
// recently — and it is what there is when the daemon is down, which F.2.16 measured as permanent:
// once the supervisor idle-exits, `logs` fails and keeps failing until a new `--bg` starts one.
//
// **The daemon is checked before it is used, and the command is trusted over the check.** A
// `claude logs` against a dead daemon takes 1.7-2.5 s to fail (G.34), which is a long time to make
// somebody wait for an answer that was never coming, and the roster answers the same question in
// under a millisecond. But the roster is a cache written by a process that may have died since, so
// a `logs` that fails anyway falls back too. The check is the optimisation; the fallback is the
// correctness.
//
// **Never polled.** One read costs a 2.7 s spawn and 330 KB (F.2.5's "never poll it"), so a preview
// is fetched when a person asks for one and carries the instant it was taken. A refresh is another
// click. SPEC §5.3's "refreshed every few seconds" was written before that measurement existed.
import {
  condense,
  type PreviewReason,
  type SessionPreview,
} from '../../contracts/session-preview.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ReadPolicy } from '../domain/read-policy.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessProbe } from '../ports/process-probe.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import type { RosterSource } from '../ports/roster-source.ts';
import { CLAUDE_LOGS_FRAME, type ScreenReader } from '../ports/screen-reader.ts';
import type { TranscriptFile } from '../ports/transcript-file.ts';
import { trailOf } from '../domain/transcript-trail.ts';

/**
 * How long `claude logs` gets.
 *
 * G.34 measured 2.7 s warm against a live daemon and 1.7-2.5 s to FAIL against a dead one, which
 * is the interesting number: the budget has to cover a spawn that is going nowhere, because the
 * roster check that should have caught it can be one second out of date.
 */
const LOGS_TIMEOUT_MS = 20_000;

/**
 * The most of a transcript the fallback reads, from the end.
 *
 * Enough for far more than the twenty records a trail shows, and small next to the 50 MB
 * transcripts on this machine. It is a window and not a budget: `TranscriptFile.tail` cuts forward
 * to the first record boundary inside it, so the only thing a bigger number would buy is more
 * records nobody is going to look at.
 */
const TAIL_BYTES = 262_144;

/** Just the half of `ClaudeInstall` this needs, so a test does not have to own a real install. */
export interface LogsCommand {
  readonly executable: string | undefined;
  envFor(subscription: SubscriptionId): Readonly<Record<string, string | undefined>>;
}

/** Where a session's transcript is — `TranscriptReader.pathOf`, as an interface (P2-T4's pattern). */
export interface TranscriptLocator {
  pathOf(sessionId: string): string | undefined;
}

export interface PreviewReaderParts {
  readonly install: LogsCommand;
  readonly runner: ProcessRunner;
  readonly roster: RosterSource;
  readonly probe: ProcessProbe;
  readonly screen: ScreenReader;
  readonly transcripts: TranscriptLocator;
  readonly file: TranscriptFile;
  /** SEC-FS-2 — asked before the transcript is opened, for `SessionDetailReader`'s reason. */
  readonly policy: ReadPolicy;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class PreviewReader {
  private readonly parts: PreviewReaderParts;

  constructor(parts: PreviewReaderParts) {
    this.parts = parts;
  }

  /**
   * One preview, from whichever source can answer.
   *
   * Never refuses: a session with no daemon, no transcript and no `claude.exe` still gets a
   * preview, with `source: 'none'` and the reason that says which of those it was. That is the
   * same choice `SessionDetailReader.read` makes and for the same reason — the deck draws "nothing
   * to show" from an empty answer and an error from a missing one, and an interactive session
   * nobody has hooked yet is the first and not the second.
   */
  public async read(ref: SessionRef): Promise<SessionPreview> {
    const blocker = this.whyNotLogs(ref);
    if (blocker === undefined) {
      const screen = await this.fromLogs(ref);
      if (screen !== undefined) return this.preview(ref, 'logs', screen, undefined);
    }
    return this.fromTranscript(ref, blocker ?? 'logs_failed');
  }

  /**
   * Why `claude logs` is not worth spawning, or `undefined` to go ahead.
   *
   * The roster is read per call rather than cached: the daemon writes it while it runs, a `--bg`
   * launch brings the supervisor back at any moment, and a cached "down" would keep a session's
   * preview on the trail for as long as core stayed up.
   */
  private whyNotLogs(ref: SessionRef): PreviewReason | undefined {
    if (this.parts.install.executable === undefined) return 'no_claude';
    const supervisor = this.parts.roster.read(ref.subscription)?.supervisorPid;
    if (supervisor === undefined || !this.parts.probe.isAlive(supervisor)) return 'daemon_down';
    return undefined;
  }

  /**
   * The screen, or `undefined` when the command did not produce one.
   *
   * An EMPTY stdout counts as no screen even at exit 0. The frame always opens by clearing and
   * painting fifty rows, so nothing is the one thing a working `logs` cannot return, and treating
   * it as a screen would show a blank box where the trail would have shown something.
   */
  private async fromLogs(ref: SessionRef): Promise<readonly string[] | undefined> {
    const executable = this.parts.install.executable;
    if (executable === undefined) return undefined;
    const result = await this.parts.runner.run({
      command: executable,
      // The SHORT id, as `stop` takes and `--resume` refuses (F.2.8b). Screened by
      // `parseSessionRef` before it reaches here, and carried rather than sliced off the uuid.
      args: ['logs', ref.shortId],
      env: this.parts.install.envFor(ref.subscription),
      timeoutMs: LOGS_TIMEOUT_MS,
    });
    if (result.code !== 0 || result.timedOut || result.stdout === '') {
      this.parts.logger.info('preview_logs_unavailable', {
        subscription: ref.subscription,
        session: ref.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      return undefined;
    }
    return this.parts.screen.read(result.stdout, CLAUDE_LOGS_FRAME);
  }

  /**
   * The trail, or an empty preview.
   *
   * `reason` is carried through every branch unchanged, and that is the point: it says why there
   * is no SCREEN, which stays true however the fallback goes. An empty `lines` with `source:
   * 'none'` is the separate fact that the fallback found nothing — see `PreviewReason`.
   */
  private async fromTranscript(ref: SessionRef, reason: PreviewReason): Promise<SessionPreview> {
    const path = this.parts.transcripts.pathOf(ref.sessionId);
    if (path === undefined) return this.preview(ref, 'none', [], reason);
    const refusal = this.parts.policy.refusal(path);
    if (refusal !== undefined) {
      // Should be unreachable — `TranscriptReader.publish` screened this path before tracking it.
      // If it fires, the interesting thing is that it fired (SessionDetailReader's `readFile`).
      this.parts.logger.warn('preview_transcript_refused', { session: ref.sessionId, refusal });
      return this.preview(ref, 'none', [], reason);
    }
    const end = await this.parts.file.tail(path, TAIL_BYTES);
    const lines = end.unreadable ? [] : trailOf(end.text, this.parts.clock.now().getTime());
    if (lines.length === 0) return this.preview(ref, 'none', [], reason);
    return this.preview(ref, 'transcript', lines, reason);
  }

  private preview(
    ref: SessionRef,
    source: SessionPreview['source'],
    lines: readonly string[],
    reason: PreviewReason | undefined,
  ): SessionPreview {
    return {
      sessionId: ref.sessionId,
      at: this.parts.clock.now().getTime(),
      source,
      lines: condense(lines),
      reason,
    };
  }
}

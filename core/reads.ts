// The read side of the composition root — lifted out of `main.ts` in P2-T4.
//
// `feeds.ts`'s sibling, and split for the same reason it was: `main.ts` reached its line limit
// again, and of what it does, this is the piece with a story of its own. The feeds are what NOTICES
// things; this is what ANSWERS a question about one of them.
//
// **It is the only place that reads a file per request.** Every other reader in core answers from
// memory, and `StatusReport` promises to — an operator's status screen must not cost two file
// opens. This one may, because of who is asking: a detail is fetched when a person clicks a row,
// and two small reads per click is the right trade for not holding every session's job history in
// memory (SessionDetailReader).
import type { SubscriptionId } from '../contracts/session.ts';
import { DaemonReader } from './application/daemon-reader.ts';
import { PreviewReader } from './application/preview-reader.ts';
import { SessionDetailReader } from './application/session-detail-reader.ts';
import type { TranscriptReader } from './application/transcript-reader.ts';
import type { VitalsRegistry } from './application/vitals-registry.ts';
import { FsJobFiles } from './adapters/node/fs-job-files.ts';
import { FsRosterSource } from './adapters/node/fs-roster-source.ts';
import { FsTranscriptFile } from './adapters/node/fs-transcript-file.ts';
import { SignalProcessProbe } from './adapters/node/signal-process-probe.ts';
import { HeadlessScreenReader } from './adapters/xterm/headless-screen-reader.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { ReadPolicy } from './domain/read-policy.ts';
import type { Clock } from './ports/clock.ts';
import type { DaemonLogSource } from './ports/daemon-log-source.ts';
import type { Logger } from './ports/logger.ts';
import type { ProcessRunner } from './ports/process-runner.ts';

export interface ReadParts {
  readonly vitals: VitalsRegistry;
  readonly transcripts: TranscriptReader;
  readonly install: ClaudeInstall;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface PreviewParts extends ReadParts {
  /** The same runner every other `claude.exe` caller takes, so one policy covers all of them. */
  readonly runner: ProcessRunner;
}

/**
 * What an expanded row reads — the join of the three producers that already knew (P2-T4).
 *
 * All three exist by the time this runs, which is the point of the task: the vitals registry and
 * the transcript reader come out of `buildFeeds`, and the only new thing is a reader for the two
 * `jobs/` files.
 *
 * `ReadPolicy` is constructed here rather than threaded out of `buildFeeds`. It is a value object
 * over two directory names, so two instances cannot disagree, and passing one around would couple
 * the feeds to a reader they do not use.
 */
export function buildDetailReader(parts: ReadParts): SessionDetailReader {
  const configDirs = configDirsFor(parts.install);
  return new SessionDetailReader({
    vitals: parts.vitals,
    transcripts: parts.transcripts,
    files: new FsJobFiles(),
    policy: new ReadPolicy(Object.values(configDirs)),
    configDirs,
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * What a session that cannot be given a terminal shows instead — P5a-T4.
 *
 * The second thing in core that reads per request, and much the more expensive of the two: it
 * spawns `claude logs` and replays a 330 KB frame through an emulator. It is here rather than in
 * `main.ts` because it is the same kind of thing as the detail reader — a question about one
 * session, asked by a person who just clicked — and because `main.ts` is at its line limit again.
 *
 * `ReadPolicy` is built from the same two directories the detail reader's is, for that function's
 * reason: it is a value object over two names, so two of them cannot disagree.
 */
export function buildPreviewReader(parts: PreviewParts): PreviewReader {
  const configDirs = configDirsFor(parts.install);
  return new PreviewReader({
    install: parts.install,
    runner: parts.runner,
    // Its own source rather than one shared with P1-T14's reader: this one is asked per preview
    // and caches nothing, and the whole value of the roster here is that it is read FRESH — a
    // supervisor that died a minute ago is exactly the state a cached answer would hide.
    roster: new FsRosterSource(parts.install),
    probe: new SignalProcessProbe(),
    screen: new HeadlessScreenReader(parts.logger),
    transcripts: parts.transcripts,
    file: new FsTranscriptFile(),
    policy: new ReadPolicy(Object.values(configDirs)),
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * What each subscription's background daemon is doing — P7-T4, SPEC §6(13).
 *
 * The third per-request reader, and the cheapest: the roster, the tail of `daemon.log` and a
 * `kill(pid, 0)` per pid it names. Its own roster source for `buildPreviewReader`'s reason — the
 * answer is only worth having FRESH.
 */
export function buildDaemonReader(
  parts: Pick<ReadParts, 'install' | 'clock'> & { readonly log: DaemonLogSource },
): DaemonReader {
  return new DaemonReader({
    roster: new FsRosterSource(parts.install),
    // The reconciler's own source (`buildFeeds`), so one adapter reads `daemon.log` for both (D62).
    log: parts.log,
    probe: new SignalProcessProbe(),
    clock: parts.clock,
  });
}

/**
 * Both config directories, keyed by subscription.
 *
 * Spelled out rather than mapped over `SUBSCRIPTION_IDS`: `Object.fromEntries` hands back a
 * `Record<string, string>` and the only way to call that a `Record<SubscriptionId, string>` is a
 * cast, which is banned (CODING-STANDARDS R13). Two keys is not worth losing the check over, and
 * the RETURN TYPE is the guard: a third subscription makes this literal stop type-checking, which
 * is exactly the moment somebody should be made to think about it.
 */
function configDirsFor(install: ClaudeInstall): Readonly<Record<SubscriptionId, string>> {
  return { isg: install.configDirFor('isg'), '365': install.configDirFor('365') };
}

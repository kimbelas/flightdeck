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
import { SessionDetailReader } from './application/session-detail-reader.ts';
import type { TranscriptReader } from './application/transcript-reader.ts';
import type { VitalsRegistry } from './application/vitals-registry.ts';
import { FsJobFiles } from './adapters/node/fs-job-files.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { ReadPolicy } from './domain/read-policy.ts';
import type { Clock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';

export interface ReadParts {
  readonly vitals: VitalsRegistry;
  readonly transcripts: TranscriptReader;
  readonly install: ClaudeInstall;
  readonly clock: Clock;
  readonly logger: Logger;
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

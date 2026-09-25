// `claude agents --json`, one config dir at a time — P1-T3.
//
// This is the only class that knows how the listing's fields map onto the domain, and D29 is what
// it implements: **liveness is the presence of `pid`**, not `state` and not `status`. F.2.1 saw a
// live three-second-old record with no `status` at all, so nothing may key off it alone.
//
// **`--all` is not optional** (RESEARCH.md F.2.2). The plain listing omits stopped and retired
// sessions entirely, so a reconciler reading it would announce `gone` for every `claude stop` —
// the session is still there, it just has no `pid` any more, which is a different row and a
// one-click resume rather than a disappearance. Added in P1-T4, when gone-detection made the
// difference load-bearing; fixtures/agents/retired.json was captured from this exact invocation.
//
// Nothing here throws. A missing binary, a non-zero exit, a timeout and a shape this build cannot
// parse all land as `failed` or as skipped records, because the alternative is a core that dies on
// the sweep after a `claude update`.
import {
  parseAgentListing,
  type AgentListing,
  type AgentRecord,
} from '../../../contracts/agents-listing.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { Session } from '../../domain/session.ts';
import { SessionId } from '../../domain/session-id.ts';
import type { Logger } from '../../ports/logger.ts';
import type { ProcessRunner } from '../../ports/process-runner.ts';
import type { LiveSessionLookup } from '../../ports/live-session-lookup.ts';
import type { SessionSource, Sweep } from '../../ports/session-source.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { ClaudeInstall } from './claude-install.ts';

/** RESEARCH.md B.2 measured ~763 ms per dir; 5 s is the CODING-STANDARDS §7 budget for this call. */
const SWEEP_TIMEOUT_MS = 5000;

export class ClaudeCliSessionSource implements SessionSource, LiveSessionLookup {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly logger: Logger;

  constructor(install: ClaudeInstall, runner: ProcessRunner, logger: Logger) {
    this.install = install;
    this.runner = runner;
    this.logger = logger;
  }

  public async sweep(subscription: SubscriptionId): Promise<Sweep> {
    const listing = await this.list(subscription);
    if (listing === undefined) return failed(subscription);
    return {
      subscription,
      sessions: listing.records.map((record) => toSession(record, subscription)),
      failed: false,
      skipped: listing.skipped,
    };
  }

  /**
   * One session's record, off a listing taken NOW — P6-T8, `LiveSessionLookup`.
   *
   * The same invocation as a sweep, `--all` included: without it a background session that has
   * stopped would read as "not listed" rather than as the background session it is, and the
   * take-over would refuse it for the wrong reason.
   */
  public async find(
    subscription: SubscriptionId,
    sessionId: string,
  ): Promise<Result<AgentRecord | undefined, 'unreadable'>> {
    const listing = await this.list(subscription);
    if (listing === undefined) return err('unreadable');
    return ok(listing.records.find((record) => record.sessionId === sessionId));
  }

  /** `agents --json --all` for one config dir, or `undefined` if it could not be read. */
  private async list(subscription: SubscriptionId): Promise<AgentListing | undefined> {
    const { executable } = this.install;
    if (executable === undefined) return undefined;

    const result = await this.runner.run({
      command: executable,
      args: ['agents', '--json', '--all'],
      env: this.install.envFor(subscription),
      timeoutMs: SWEEP_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('sweep_failed', {
        subscription,
        code: result.code,
        timedOut: result.timedOut,
      });
      return undefined;
    }

    const listing = parseAgentListing(result.stdout);
    if (listing.skipped > 0) {
      // Visible rather than silent: a non-zero count here means the shape changed (D28).
      this.logger.warn('sweep_skipped_records', { subscription, skipped: listing.skipped });
    }
    return listing;
  }
}

function failed(subscription: SubscriptionId): Sweep {
  return { subscription, sessions: [], failed: true, skipped: 0 };
}

/**
 * One record to one Session.
 *
 * `kind` defaults to interactive: F.2.1 found `id` and `state` only on background records, so a
 * record carrying neither is interactive — and if a future build omits `kind` entirely, treating
 * it as interactive is the safe default, because interactive sessions are the ones Flightdeck
 * refuses to attach (SPEC §5.2).
 */
function toSession(record: AgentRecord, subscription: SubscriptionId): Session {
  return Session.start(
    {
      id: SessionId.parse(record.sessionId),
      subscription,
      kind: record.kind ?? 'interactive',
      name: record.name,
      cwd: record.cwd ?? '',
      startedAt: new Date(record.startedAt ?? 0),
    },
    {
      runState: record.state,
      status: record.status,
      // D29: the presence of `pid` IS the liveness test.
      live: record.pid !== undefined,
    },
  );
}

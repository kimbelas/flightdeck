// One headless question, streamed while it runs — P4-T4, SEC-PROC-4, D47, D48.
//
// **One run at a time, and `busy` is a real answer.** Not a queue: a queue would let the owner
// press Ask four times, walk away, and come back to four runs' worth of spend they cannot now
// choose not to make. SEC-PROC-4 caps what one run costs; the slot is what caps how many there
// are. The refusal is named rather than silent so the panel can say why the button did nothing.
//
// **The records go out on the existing `/stream`, not down the POST** (D48). `POST /run` answers
// `{runId}` and returns; every record arrives as an `ask` frame beside `snapshot` and `quota`. The
// deck has had exactly one live feed since P1-T9 removed the second polling loop, and P2-T3 chose
// a replayed frame over a poll for the header; a second streaming transport for this one panel
// would be the thing both of those decisions argued against. It also means a deck that reloads
// mid-run keeps receiving the answer, which a response body could not survive.
//
// **The audit row is written when the run STARTS and again when it ends.** Unlike `rm`, an Ask is
// not instantaneous — it spends money over minutes — so a row written only at the end would leave
// a crash mid-run unrecorded, which is the case somebody would actually want the trail for.
import {
  askBudgetInRange,
  ASK_TIMEOUT_MS,
  type AskRefusal,
  type AskRequest,
} from '../../contracts/ask-run.ts';
import { parseAskLine, type AskFrame, type AskRecord } from '../../contracts/ask-record.ts';
import type { AskCommands } from '../ports/ask-commands.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessStream, ProcessStreamResult } from '../ports/process-stream.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

/** What the runner publishes. `Feeds` gives it the stream's publisher (D48). */
export interface AskPublisher {
  publish(frame: AskFrame): void;
}

export interface AskRunnerParts {
  readonly commands: AskCommands;
  readonly stream: ProcessStream;
  readonly publisher: AskPublisher;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class AskRunner {
  private readonly commands: AskCommands;
  private readonly stream: ProcessStream;
  private readonly publisher: AskPublisher;
  private readonly audit: AuditLog;
  private readonly clock: Clock;
  private readonly logger: Logger;
  /** The single slot. `undefined` when nothing is running — see the header for why not a queue. */
  private running: string | undefined;

  constructor(parts: AskRunnerParts) {
    this.commands = parts.commands;
    this.stream = parts.stream;
    this.publisher = parts.publisher;
    this.audit = parts.audit;
    this.clock = parts.clock;
    this.logger = parts.logger;
  }

  /** Which run is in flight, or `undefined`. The deck reads it to draw the button's state. */
  public get inFlight(): string | undefined {
    return this.running;
  }

  /**
   * Accepts a run and starts it, or says why not.
   *
   * It answers as soon as the child is SPAWNED, not when it finishes: the run is minutes long and
   * the records are the answer. The returned promise therefore resolves with the run id, and
   * everything after that arrives on the stream.
   */
  public start(request: AskRequest): Result<string, AskRefusal> {
    if (this.running !== undefined) return err('busy');
    if (!askBudgetInRange(request)) return err('bad_budget');
    const command = this.commands.forRun(request);
    if (command === undefined) return err('no_claude');

    const runId = this.nextRunId();
    this.running = runId;
    this.audit.record({
      action: 'ask',
      target: request.subscription,
      // The prompt is deliberately NOT in the row: it is the owner's text, the audit table is read
      // by eye, and what the trail needs is that a run happened and what it was allowed to do.
      args: ['ask', request.permissionMode, `$${String(request.budgetUsd)}`],
      outcome: 'ok',
    });
    void this.pump(runId, request, command);
    return ok(runId);
  }

  /** Spawns, relays, and frees the slot whatever happens — including a throw from the port. */
  private async pump(
    runId: string,
    request: AskRequest,
    command: ReturnType<AskCommands['forRun']>,
  ): Promise<void> {
    if (command === undefined) return;
    try {
      const result = await this.stream.run(
        { ...command, timeoutMs: ASK_TIMEOUT_MS },
        {
          onLine: (line) => {
            this.relay(runId, request, line);
          },
        },
      );
      this.finish(runId, request, result);
    } catch (cause) {
      // The port promises never to throw. If one ever does, the slot must still be freed, or the
      // panel is dead until core restarts — the failure mode worth a catch that should be dead.
      this.finish(runId, request, {
        code: -1,
        timedOut: false,
        stderr: cause instanceof Error ? cause.message : 'failed',
      });
    } finally {
      this.running = undefined;
    }
  }

  /** One line of stdout, narrowed and published. A line this build cannot read is dropped. */
  private relay(runId: string, request: AskRequest, line: string): void {
    const record = parseAskLine(line);
    if (record === undefined) return;
    this.publisher.publish({ runId, subscription: request.subscription, record });
  }

  /**
   * The closing frame.
   *
   * Published unconditionally, even though a successful run emits its own `result` record: a child
   * killed on the timeout, or one that died before it printed anything, produces no `result` at
   * all, and a panel waiting for one would spin forever. A second `done` after the CLI's own is
   * harmless — the panel takes the first and the run is over either way.
   */
  private finish(runId: string, request: AskRequest, ended: ProcessStreamResult): void {
    const { code, timedOut, stderr } = ended;
    const succeeded = code === 0 && !timedOut;
    if (!succeeded) {
      // stderr is logged and never published: it is the child's, it can carry a path, and
      // SEC-DATA-2 keeps the owner's filesystem off this screen. What crosses the wire is a word.
      this.logger.warn('ask_failed', {
        subscription: request.subscription,
        code,
        timedOut,
        stderr,
      });
    }
    this.audit.record({
      action: 'ask',
      target: request.subscription,
      args: ['ask', 'end'],
      outcome: succeeded ? 'ok' : 'failed',
      ...(succeeded ? {} : { reason: timedOut ? 'timed out' : `exit ${String(code)}` }),
    });
    const record: AskRecord = {
      kind: 'done',
      ok: succeeded,
      costUsd: undefined,
      durationMs: undefined,
      stopReason: succeeded ? 'ended' : timedOut ? 'timed out' : 'failed',
    };
    this.publisher.publish({ runId, subscription: request.subscription, record });
  }

  /** Monotonic within a core lifetime, which is all a run id has to be — it never leaves it. */
  private nextRunId(): string {
    return `ask-${String(this.clock.now().getTime())}`;
  }
}

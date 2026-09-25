// What Claude ACTUALLY did in one folder — SPEC §5.1(b), P3-T5.
//
// Its sibling is `WorkflowMap`, which is what Claude is CONFIGURED to do there. SPEC's own framing
// is that the contrast between the two is the part nothing else shows, so the two are separate
// types on separate routes with separate costs: a map is a directory listing and a head read per
// asset, and this is every transcript of the folder, in both subscriptions, read end to end.
//
// **It costs MORE than a `claude logs` costs, so it is a button** (P5a-T4's rule). Measured on
// this repository's own slug: 42 files, 83.7 MB, 30 058 lines in 1 149 ms — 73 MB/s. But the
// biggest project on this machine is `xpert-new`, and running it against the real core read
// 423 MB across 85 transcripts in 9 933 ms. The earlier "~2.8 s worst case" came from the
// biggest slug in ONE config dir; the read is of BOTH, and it is four times that (G.47).
// Ten seconds is not a poll's budget under any reading, which is why nothing asks for this on a
// timer and nothing asks for every project at once.
//
// **Everything here was measured before it was typed.** The list SPEC gives is seven things, and
// each one's source in the transcript was found by reading this machine's own files rather than
// inferred — see `RESEARCH.md` G.47 for the counts and for the one that had no source until
// `message.usage` turned out to be on every assistant record.
import { MAX_PROJECT_PATH_CHARS } from './project.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** How many of each thing a panel will draw before it stops. Long tails are not a dashboard. */
export const MAX_OBSERVED_ENTRIES = 8;

/** A name and how often it happened. Tools, skills, agents and files are all this shape. */
export interface ObservedCount {
  readonly name: string;
  readonly count: number;
}

/**
 * One KIND of scheduled task and how often it fired here — P7-T4, SPEC §6(11).
 *
 * Per kind rather than per task because a `/loop` wake-up is a one-shot with a fresh `taskId` every
 * time (core/domain/schedule-tally.ts), so a per-task list would be a column of ones.
 */
export interface ObservedSchedule {
  /** `loop`, or `scheduled` for the older shape that named no kind. */
  readonly kind: string;
  readonly fires: number;
  /** How many of the folder's sessions it fired in. */
  readonly sessions: number;
  /** The newest fire, epoch ms, or `undefined` when none carried a timestamp. */
  readonly lastAt: number | undefined;
  /** The cron the newest fire ran on, in the machine's local time, when it said. */
  readonly lastCron: string | undefined;
}

/** One subscription's share of the work in a folder. */
export interface ObservedShare {
  readonly subscription: SubscriptionId;
  readonly sessions: number;
  readonly costUsd: number;
}

/**
 * What the transcripts of one folder add up to.
 *
 * Every field is a count of something observed, and a zero means it was looked for and not found —
 * which is why nothing here is optional. `compactions: 0` is a real answer about this repository's
 * own slug, and the difference between that and "not read" is `at`.
 */
export interface ObservedBehaviour {
  /** The project this is about — the stored path, so the deck can match it to a row. */
  readonly path: string;
  /** When the reading was taken, epoch ms. */
  readonly at: number;
  /** How long it took to read, in ms. Printed, because this is the deck's most expensive read. */
  readonly tookMs: number;
  /** Transcript files read, across both subscriptions. */
  readonly sessions: number;
  /** Of those, the ones whose newest record is within the last seven days. */
  readonly sessionsThisWeek: number;
  /** Bytes read. The honest cost of the answer above it. */
  readonly bytesRead: number;
  /** Which subscription this folder runs under, and what it has cost on each. */
  readonly shares: readonly ObservedShare[];
  readonly tools: readonly ObservedCount[];
  /** Skill invocations, from `Skill` tool calls — the only place a skill leaves a trace. */
  readonly skills: readonly ObservedCount[];
  /**
   * The names the sessions in this folder ran under — from `agent-name`, measured.
   *
   * **SPEC §5.1(b) asks for "subagents" here and this is not that**, which is a correction rather
   * than a substitution. Read off this machine's own transcripts, `agentName` is the SESSION's
   * name — `flightdeck` 583 times, then `deck-demo`, `fd-pane-1`, `fd-t5-probe`: the values
   * `--name` was given. There is no subagent roster in a transcript.
   *
   * Subagent USE is still reported, in `tools`, where `Agent` appears like any other tool. Which
   * subagent would be `Agent`'s `input.subagent_type`, and tool input does not reach a record
   * (SEC-UI-2 — `skill` is the one named exception, and this folder has no `Agent` calls to
   * measure a second one against).
   */
  readonly sessionNames: readonly ObservedCount[];
  readonly files: readonly ObservedCount[];
  /**
   * The median of each session's PEAK context, in tokens.
   *
   * Per session rather than per turn: "median context reached" is a question about how close the
   * work in this folder gets to the window, and the median of every turn would be dominated by the
   * cheap turns at the start of each one. `0` when no session reported usage at all.
   */
  readonly medianPeakContextTokens: number;
  readonly compactions: number;
  /** `scheduled_task_fire` — loops and crons that fired in this folder. */
  readonly scheduledFires: number;
  /** Those fires, by kind — what the count above is made of (P7-T4). */
  readonly schedules: readonly ObservedSchedule[];
  /**
   * Lines whose type this build has never seen — SPEC §8 R2's drift alarm, over a whole folder.
   *
   * It is here rather than only in `doctor` because this is the widest read in the product: if a
   * Claude Code release moves the transcript format, this is where it shows up first and in bulk.
   */
  readonly unknownLines: number;
}

/** One reading off `GET /projects/observed`. @throws never. */
export function parseObservedBehaviour(value: unknown): ObservedBehaviour | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const path = fields['path'];
  const at = fields['at'];
  if (typeof path !== 'string' || path === '' || path.length > MAX_PROJECT_PATH_CHARS) {
    return undefined;
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  return {
    path,
    at,
    tookMs: whole(fields['tookMs']),
    sessions: whole(fields['sessions']),
    sessionsThisWeek: whole(fields['sessionsThisWeek']),
    bytesRead: whole(fields['bytesRead']),
    shares: shareList(fields['shares']),
    tools: countList(fields['tools']),
    skills: countList(fields['skills']),
    sessionNames: countList(fields['sessionNames']),
    files: countList(fields['files']),
    medianPeakContextTokens: whole(fields['medianPeakContextTokens']),
    compactions: whole(fields['compactions']),
    scheduledFires: whole(fields['scheduledFires']),
    schedules: scheduleList(fields['schedules']),
    unknownLines: whole(fields['unknownLines']),
  };
}

function scheduleList(value: unknown): readonly ObservedSchedule[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry: unknown) => {
      const fields = asRecord(entry);
      const kind = fields?.['kind'];
      if (fields === undefined || typeof kind !== 'string' || kind === '') return [];
      const lastAt = fields['lastAt'];
      const lastCron = fields['lastCron'];
      return [
        {
          kind: kind.slice(0, MAX_NAME_CHARS),
          fires: whole(fields['fires']),
          sessions: whole(fields['sessions']),
          lastAt: typeof lastAt === 'number' && Number.isFinite(lastAt) ? lastAt : undefined,
          lastCron:
            typeof lastCron === 'string' && lastCron !== '' ? lastCron.slice(0, 40) : undefined,
        },
      ];
    })
    .slice(0, MAX_OBSERVED_ENTRIES);
}

function countList(value: unknown): readonly ObservedCount[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry: unknown) => {
      const fields = asRecord(entry);
      const name = fields?.['name'];
      if (typeof name !== 'string' || name === '') return [];
      return [{ name: name.slice(0, MAX_NAME_CHARS), count: whole(fields?.['count']) }];
    })
    .slice(0, MAX_OBSERVED_ENTRIES);
}

function shareList(value: unknown): readonly ObservedShare[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const fields = asRecord(entry);
    const subscription = SUBSCRIPTION_IDS.find((id) => id === fields?.['subscription']);
    if (subscription === undefined) return [];
    return [
      {
        subscription,
        sessions: whole(fields?.['sessions']),
        costUsd: positive(fields?.['costUsd']),
      },
    ];
  });
}

/** A tool, a skill, an agent or a file path, capped where it is parsed (`job-state.ts`'s rule). */
const MAX_NAME_CHARS = 160;

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Cost is not whole — `$0.12` is a real answer, and flooring it would report nothing spent. */
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

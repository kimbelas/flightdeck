// Works out what Connect would do, without doing any of it (P1-T11, D13, SEC-FS-3).
//
// It takes the current contents of every file it would touch and returns whole before/after pairs.
// Nothing here opens a file, and that is the point: the owner sees the complete diff of both
// subscriptions and the shared statusline.py before one byte is written, and a planner that could
// not write could not be talked into writing early.
//
// **Every failure is a refusal, never a throw** (F.3.7). A settings.json that is not valid JSON,
// a statusline.py whose anchors have moved, a `statusLine` that points somewhere else — each is a
// sentence naming the file, and the whole plan fails rather than half of it applying.
import type {
  ConnectPlan,
  EnvironmentStep,
  FileChange,
  PlanRefusal,
} from '../../contracts/connect-plan.ts';
import type { SessionEnvironment } from '../ports/session-environment.ts';
import type { SourcePatcher } from '../ports/source-patcher.ts';
import { JsonFormat } from '../shared/json-format.ts';
import { HooksBlock } from './hooks-block.ts';

/** One config dir's settings.json, as read. `contents` is `undefined` when the file is absent. */
export interface SettingsSource {
  readonly subscription: string;
  readonly path: string;
  readonly contents: string | undefined;
}

/** The shared `~/.claude/hooks/statusline.py` both subscriptions' statusLine commands point at. */
export interface StatuslineSource {
  readonly path: string;
  readonly contents: string | undefined;
}

export interface ConnectPlannerParts {
  readonly settings: readonly SettingsSource[];
  readonly statusline: StatuslineSource;
  readonly patcher: SourcePatcher;
  readonly environment: SessionEnvironment;
}

export class ConnectPlanner {
  private readonly settings: readonly SettingsSource[];
  private readonly statusline: StatuslineSource;
  private readonly patcher: SourcePatcher;
  private readonly environment: SessionEnvironment;
  private readonly block = new HooksBlock();

  constructor(parts: ConnectPlannerParts) {
    this.settings = parts.settings;
    this.statusline = parts.statusline;
    this.patcher = parts.patcher;
    this.environment = parts.environment;
  }

  /** What Connect would write. `alreadyDone` names files that need nothing, which is not an error. */
  public connect(): ConnectPlan {
    return this.plan('connect');
  }

  /** What Disconnect would write. The exact inverse, file for file. */
  public disconnect(): ConnectPlan {
    return this.plan('disconnect');
  }

  private plan(direction: 'connect' | 'disconnect'): ConnectPlan {
    const changes: FileChange[] = [];
    const alreadyDone: string[] = [];
    const refusals: PlanRefusal[] = [];

    for (const source of this.settings) {
      const outcome = this.planSettings(source, direction);
      collect(outcome, changes, alreadyDone, refusals);
    }
    collect(this.planStatusline(direction), changes, alreadyDone, refusals);

    if (refusals.length > 0) return { ok: false, refusals };

    const published = this.environment.isPublished();
    const environment: EnvironmentStep =
      direction === 'connect' ? (published ? 'none' : 'publish') : published ? 'withdraw' : 'none';
    if (environment === 'none') alreadyDone.push(`${this.environment.describe()} (already set)`);
    return {
      ok: true,
      changes,
      alreadyDone,
      environment,
      environmentLabel: this.environment.describe(),
    };
  }

  private planSettings(source: SettingsSource, direction: 'connect' | 'disconnect'): Outcome {
    const { path, contents } = source;
    if (contents === undefined) {
      return { kind: 'refusal', refusal: { path, reason: 'settings.json does not exist' } };
    }
    const parsed = parseObject(contents);
    if (parsed === undefined) {
      // SEC-FS-3: refuse a file that is not valid JSON or not a JSON object. Overwriting one would
      // replace whatever the owner actually had with what we could make sense of.
      return { kind: 'refusal', refusal: { path, reason: 'not a JSON object' } };
    }
    const applied = this.block.isApplied(parsed);
    if (direction === 'connect' && applied)
      return { kind: 'done', label: `${path} (already connected)` };
    if (direction === 'disconnect' && !applied)
      return { kind: 'done', label: `${path} (not connected)` };

    const next = direction === 'connect' ? this.block.merge(parsed) : this.block.remove(parsed);
    return {
      kind: 'change',
      change: {
        path,
        label: `${source.subscription} · settings.json`,
        before: contents,
        // Printed back in the file's OWN convention, not in stringify's. The two config dirs
        // disagree about line endings on this machine, and re-printing isg's CRLF file as LF
        // rewrote all 88 of its lines while claiming to add five handlers (RESEARCH.md G.13).
        after: JsonFormat.of(contents).print(next),
      },
    };
  }

  /**
   * The statusLine patch, which is per machine rather than per subscription.
   *
   * Both config dirs' `statusLine.command` point at the same `~/.claude/hooks/statusline.py`, so
   * it is patched once. Connect verifies that before it writes — a patch applied to a file nobody
   * runs is worse than no patch, because it looks done.
   */
  private planStatusline(direction: 'connect' | 'disconnect'): Outcome {
    const { path, contents } = this.statusline;
    if (contents === undefined) {
      return { kind: 'refusal', refusal: { path, reason: 'statusline.py does not exist' } };
    }
    const applied = this.patcher.isApplied(contents);
    if (direction === 'connect' && applied)
      return { kind: 'done', label: `${path} (already patched)` };
    if (direction === 'disconnect' && !applied)
      return { kind: 'done', label: `${path} (not patched)` };

    const outcome =
      direction === 'connect' ? this.patcher.apply(contents) : this.patcher.remove(contents);
    if (!outcome.ok) {
      return { kind: 'refusal', refusal: { path, reason: outcome.reason } };
    }
    return {
      kind: 'change',
      change: { path, label: 'shared · statusline.py', before: contents, after: outcome.source },
    };
  }
}

type Outcome =
  | { readonly kind: 'change'; readonly change: FileChange }
  | { readonly kind: 'done'; readonly label: string }
  | { readonly kind: 'refusal'; readonly refusal: PlanRefusal };

function collect(
  outcome: Outcome,
  changes: FileChange[],
  alreadyDone: string[],
  refusals: PlanRefusal[],
): void {
  if (outcome.kind === 'change') changes.push(outcome.change);
  else if (outcome.kind === 'done') alreadyDone.push(outcome.label);
  else refusals.push(outcome.refusal);
}

/** Valid JSON that is also a plain object. An array or a number parses and is still not settings. */
function parseObject(contents: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(contents);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.entries(value));
  } catch {
    return undefined;
  }
}

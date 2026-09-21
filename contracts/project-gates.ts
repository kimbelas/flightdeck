// What `.claude/gates.json` actually says, and where its verdict actually lives — P3-T6, D12.
//
// **The task's premise was wrong and the measurement is the finding.** SPEC §5.1(a)'s table reads
// "`.claude/gates.json` (coach-core) | show its verdict, deep-link to coach :4747 — never
// re-score". There is no verdict in that file. Read off the only one on this machine
// (`groundwork/.claude/gates.json`, 1 452 bytes), it is a **definition of the gates themselves**:
// `denyPaths`, `askPaths`, and three lists of commands — `lint` per changed file, `stopChecks` at
// the end of a turn, `verify` before shipping. No score, no pass, no fail, no date.
//
// So this shows what the gates ARE, which is a real answer to "what does Claude do in this repo?",
// and links to coach for the verdict — which lives in coach's own `brain` and `computeReadiness`,
// rendered at `/plans/<project>`, and is coach's to compute. D12 is unchanged and is now enforced
// by a fact rather than by restraint: there is nothing here to re-score even if this wanted to.
//
// **Everything is capped where it is parsed** (`job-state.ts`'s rule). A gate's label reaches a
// screen, so a `gates.json` with a 40 KB command in it costs the panel one line, not the panel.
import { MAX_PROJECT_PATH_CHARS } from './project.ts';

/** Coach's own port and the page a project's verdict is on. Measured against `app/plans/[project]`. */
export const COACH_ORIGIN = 'http://127.0.0.1:4747';

/**
 * Where coach shows this project's verdict.
 *
 * Keyed by the project's NAME, because that is what coach keys a plan by — `getPlan(project)` on
 * `plan.project`, not on a path. Flightdeck derives the name the same way it always has, from the
 * imported folder's last segment (`contracts/project.ts`).
 */
export function coachPlanUrl(name: string): string {
  return `${COACH_ORIGIN}/plans/${encodeURIComponent(name)}`;
}

/** When a gate runs. The three lists `gates.json` keeps, named as the moments they fire. */
export type GateKind = 'lint' | 'stop' | 'verify';

export const GATE_KINDS: readonly GateKind[] = ['lint', 'stop', 'verify'];

/** How long a gate's label may be before it is cut. Enough for a `pnpm exec` line and no more. */
export const MAX_GATE_LABEL_CHARS = 120;

/** One gate, as a person would read it off the panel. */
export interface ProjectGate {
  readonly kind: GateKind;
  /**
   * Its own `label` where it has one, and its `command` where it does not.
   *
   * `stopChecks` and `verify` entries carry a label in the file measured; `lint` entries do not,
   * and their command is the only thing that names them. Falling back to the command rather than
   * to "lint gate" keeps the row saying which linter, which is the part worth knowing.
   */
  readonly label: string;
}

/**
 * What a project's `gates.json` configures. `undefined` on a project that has none.
 *
 * The paths are COUNTS rather than the globs themselves. The globs are long, there are five of
 * them in the file measured, and "coach denies five paths here" is the fact a dashboard row is
 * for — the list itself is one `cat` away and is coach's screen, not this one.
 */
export interface ProjectGates {
  readonly denyPaths: number;
  readonly askPaths: number;
  readonly gates: readonly ProjectGate[];
}

/**
 * Reads a parsed `.claude/gates.json`, or `undefined` for anything that is not one.
 *
 * Undefined rather than an empty `ProjectGates`, and the difference is the one this file exists to
 * draw: absent means the project is not coached, and an empty one means it is coached and gates
 * nothing. The deck draws different rows for those.
 *
 * It takes the PARSED value rather than the text, like every other reading the workflow map
 * composes: `WorkflowMapReader.json` is the one thing that opens a file there, and a second
 * `JSON.parse` in a contract would be a second place a malformed file could be read differently.
 *
 * @throws never.
 */
export function parseProjectGates(value: unknown): ProjectGates | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  return {
    denyPaths: countOf(fields['denyPaths']),
    askPaths: countOf(fields['askPaths']),
    gates: [
      ...gatesOf('lint', fields['lint']),
      ...gatesOf('stop', fields['stopChecks']),
      ...gatesOf('verify', fields['verify']),
    ],
  };
}

/** One `ProjectGates` off the wire. @throws never. */
export function parseProjectGatesReply(value: unknown): ProjectGates | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const denyPaths = fields['denyPaths'];
  const askPaths = fields['askPaths'];
  if (typeof denyPaths !== 'number' || typeof askPaths !== 'number') return undefined;
  const raw = fields['gates'];
  const gates = Array.isArray(raw) ? raw.flatMap(oneGate) : [];
  return { denyPaths: whole(denyPaths), askPaths: whole(askPaths), gates };
}

/** How many gates of one kind. Zero is an answer and is drawn as one. */
export function gatesOfKind(gates: ProjectGates, kind: GateKind): number {
  return gates.gates.filter((gate) => gate.kind === kind).length;
}

function oneGate(value: unknown): readonly ProjectGate[] {
  if (typeof value !== 'object' || value === null) return [];
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const kind = GATE_KINDS.find((known) => known === fields['kind']);
  const label = fields['label'];
  if (kind === undefined || typeof label !== 'string' || label === '') return [];
  return [{ kind, label: label.slice(0, MAX_GATE_LABEL_CHARS) }];
}

/** Every entry of one list, named and capped. Anything that names nothing is dropped. */
function gatesOf(kind: GateKind, value: unknown): readonly ProjectGate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(entry));
    const named = [fields['label'], fields['command']].find(
      (candidate) => typeof candidate === 'string' && candidate.trim() !== '',
    );
    if (typeof named !== 'string') return [];
    return [{ kind, label: named.trim().slice(0, MAX_GATE_LABEL_CHARS) }];
  });
}

/** How many entries a path list has. A list of anything else counts as none rather than as many. */
function countOf(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter(
    (entry) => typeof entry === 'string' && entry !== '' && entry.length <= MAX_PROJECT_PATH_CHARS,
  ).length;
}

function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

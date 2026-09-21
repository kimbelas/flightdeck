// What the deck asks for when it asks a question — P4-T4, SPEC §5.2, SEC-PROC-4, D47.
//
// **An Ask names a SUBSCRIPTION, not a profile function, and that is the whole of D47.** Every
// other spawn in this codebase goes through one of the four profile functions, because D4 put
// model routing there and P4-T2 made the launcher honour it. Ask is the one exception, and it is
// not a preference: all four functions pass `--dangerously-skip-permissions` unconditionally, and
// a run started through one reports `permissionMode: "bypassPermissions"` whatever else is on the
// command line. `--permission-mode` is not refused in that case — it is SILENTLY IGNORED
// (RESEARCH.md F.9.3, measured on all three values). SEC-PROC-4 says an Ask never runs with
// `--dangerously-skip-permissions` unless it says so explicitly, and SPEC §5.2 lists permission
// mode as one of Ask's own controls; through a profile function, that control is a dropdown that
// does nothing and the security control is unenforceable. So Ask spawns the binary directly with
// `CLAUDE_CONFIG_DIR` set — which is exactly what P4-T2 took away from the LAUNCHER, for a reason
// that does not apply to a one-shot headless read nobody attaches to.
//
// **`bypassPermissions` is therefore absent from `ASK_PERMISSION_MODES`.** The union is what the
// deck may ask for, and the flag it excludes is the one SEC-PROC-4 names. A mode this build does
// not know is refused at the parse rather than coerced to a default, because "the dropdown said
// plan and it ran unsandboxed" is the single failure this whole file exists to prevent.
//
// **The budget is capped on the way in, not just defaulted.** A default of 2 that a request may
// overwrite with 2000 is not a control. `ASK_MAX_BUDGET_USD` is the ceiling and a request above it
// is refused rather than clamped — a clamp would run something the owner did not ask for.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/**
 * The permission modes an Ask may run in.
 *
 * Three, where the CLI has four. `bypassPermissions` is the missing one and its absence is
 * SEC-PROC-4 in the type system: a value the deck cannot send is a run core cannot be asked for.
 */
export const ASK_PERMISSION_MODES = ['plan', 'default', 'acceptEdits'] as const;
export type AskPermissionMode = (typeof ASK_PERMISSION_MODES)[number];

/** Plan mode reads and proposes; it does not edit. The safe thing to land on by accident. */
export const ASK_DEFAULT_PERMISSION_MODE: AskPermissionMode = 'plan';

/** SEC-PROC-4's number. Every run carries one, and this is what it is when nobody chose. */
export const ASK_DEFAULT_BUDGET_USD = 2;
/** The ceiling. A request above it is REFUSED, not clamped — see the header. */
export const ASK_MAX_BUDGET_USD = 20;
/** SEC-PROC-4 also requires `--max-turns`. A question that needed 30 turns is not a question. */
export const ASK_DEFAULT_MAX_TURNS = 12;
export const ASK_MAX_TURNS = 40;

export const MAX_ASK_PROMPT_CHARS = 8000;
export const MAX_ASK_CWD_CHARS = 1024;

/**
 * How long a run may take before core stops waiting.
 *
 * Generous, because a real question with tool use is minutes rather than seconds, and the budget
 * cap is the control that actually bounds the cost. This bounds the PROCESS, so a wedged child
 * cannot hold the single run slot forever.
 */
export const ASK_TIMEOUT_MS = 600_000;

export interface AskRequest {
  readonly subscription: SubscriptionId;
  readonly prompt: string;
  /** A folder core has screened, or `''` for core's own. Never a path straight off the wire. */
  readonly cwd: string;
  readonly permissionMode: AskPermissionMode;
  readonly budgetUsd: number;
  readonly maxTurns: number;
}

/**
 * Why a run would not start.
 *
 * A closed union, as `PresetRefusal` is: core names the cause and the deck writes the English.
 * Every member is reachable — `busy` because one run at a time is a real limit (see `AskRunner`),
 * `no_claude` because the binary genuinely goes missing during an npm update (F.1.5).
 */
export const ASK_REFUSALS = [
  'empty',
  'bad_prompt',
  'bad_subscription',
  'bad_budget',
  'busy',
  'no_claude',
] as const;
export type AskRefusal = (typeof ASK_REFUSALS)[number];

/** What `POST /run` answers when it accepted. The records arrive on `/stream` (D48). */
export interface AskAccepted {
  readonly runId: string;
}

/**
 * A request out of a body, or `undefined` for a body that is not one.
 *
 * Refuses rather than coerces on every closed field — subscription and permission mode — and caps
 * the two numbers at the parse. A body naming a permission mode this build does not know is not a
 * body with a typo in it; it is a body from something that wants a mode this build will not run.
 *
 * @throws never.
 */
export function parseAskRequest(body: string): AskRequest | undefined {
  const fields = asRecord(readJson(body));
  if (fields === undefined) return undefined;
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
  const permissionMode = ASK_PERMISSION_MODES.find((mode) => mode === fields['permissionMode']);
  const prompt = text(fields['prompt'], MAX_ASK_PROMPT_CHARS);
  if (subscription === undefined || prompt === '') return undefined;
  return {
    subscription,
    prompt,
    cwd: text(fields['cwd'], MAX_ASK_CWD_CHARS),
    permissionMode: permissionMode ?? ASK_DEFAULT_PERMISSION_MODE,
    budgetUsd: numberOr(fields['budgetUsd'], ASK_DEFAULT_BUDGET_USD),
    maxTurns: Math.round(numberOr(fields['maxTurns'], ASK_DEFAULT_MAX_TURNS)),
  };
}

/**
 * Whether the two numbers are inside SEC-PROC-4's bounds.
 *
 * Separate from the parse so the route can answer `bad_budget` rather than `empty`: "the body was
 * not a request" and "the body asked to spend forty dollars" are different sentences, and only one
 * of them is worth showing the owner.
 */
export function askBudgetInRange(request: AskRequest): boolean {
  const { budgetUsd, maxTurns } = request;
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > ASK_MAX_BUDGET_USD) return false;
  return Number.isInteger(maxTurns) && maxTurns > 0 && maxTurns <= ASK_MAX_TURNS;
}

/** The refusal in an error body, or `undefined` for one this build does not know. @throws never. */
export function parseAskRefusal(value: unknown): AskRefusal | undefined {
  const error: unknown = asRecord(value)?.['error'];
  return ASK_REFUSALS.find((refusal) => refusal === error);
}

/** The accepted reply, or `undefined`. @throws never. */
export function parseAskAccepted(value: unknown): AskAccepted | undefined {
  const runId = text(asRecord(value)?.['runId'], 64);
  return runId === '' ? undefined : { runId };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function text(value: unknown, cap: number): string {
  return typeof value === 'string' ? value.trim().slice(0, cap) : '';
}

/** A missing number takes the default; a present one that is not a number does NOT. */
function numberOr(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' ? value : Number.NaN;
}

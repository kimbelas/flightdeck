// The remaps the keyboard helper writes, and the shape of the file it writes them into — P5a-T7.
//
// **The schema here is measured, not assumed.** `keybindings.json` is Claude Code's file and this
// project does not own its format, so the shape below and every action name in `RECLAIMED_KEYS`
// were read off the installed CLI (2.1.278) rather than inferred from the docs — RESEARCH.md G.33
// has what that turned up, including the half of this task that is not possible.
//
// In contracts/ for connect-plan.ts's reason: the planner produces a plan and the deck renders it,
// so both sides must agree, and contracts/ is the only folder both TypeScript projects compile.

import {
  parseFileChange,
  parsePlanRefusal,
  type FileChange,
  type PlanRefusal,
} from './connect-plan.ts';

/**
 * What the helper would write. `FileChange` and `PlanRefusal` are Connect's own, imported rather
 * than copied: two plan shapes that rendered differently would be two diff views for the same
 * promise, and the promise — the owner sees the whole thing before a byte moves — is D13's.
 */
export type KeybindingPlan =
  | {
      readonly ok: true;
      readonly changes: readonly FileChange[];
      readonly alreadyDone: readonly string[];
    }
  | { readonly ok: false; readonly refusals: readonly PlanRefusal[] };

/** What a write did. `backups` is the point of it — where each previous file went. */
export interface KeybindingWrite {
  readonly written: readonly string[];
  readonly backups: readonly string[];
  readonly alreadyDone: readonly string[];
}

export type KeybindingDirection = 'apply' | 'restore';

/** Claude Code validates against this and links this. Written on every file the helper creates. */
export const KEYBINDINGS_SCHEMA = 'https://www.schemastore.org/claude-code-keybindings.json';
export const KEYBINDINGS_DOCS = 'https://code.claude.com/docs/en/keybindings';

/** One context's overrides. `null` unbinds a default — which is half of moving one. */
export interface KeybindingContext {
  readonly context: string;
  readonly bindings: Readonly<Record<string, string | null>>;
}

/**
 * One remap, and why it is worth making.
 *
 * `from` is unbound and `to` is bound to the same action, because user bindings are ADDITIVE:
 * adding the chord alone would leave the browser-stolen key still bound underneath, which is not
 * a move, it is a second way to reach the same thing plus the original problem.
 */
export interface KeyRemap {
  readonly context: string;
  readonly from: string;
  readonly to: string;
  readonly action: string;
  /** What the browser does with `from` instead. Present tense: this is a fact, not a warning. */
  readonly stolenBy: string;
}

/**
 * The keys this helper moves. Two, and the shortness of the list is the finding.
 *
 * Of everything the browser takes (contracts/reserved-keys.ts), only a key Claude Code binds
 * through `keybindings.json` can be moved by writing that file, and only these two qualify:
 *
 *   - **Ctrl+W cannot be remapped at all.** Delete-word is not an action in the keybindings system
 *     on 2.1.278 — `ctrl+w` appears exactly once in the whole CLI, as a worktree chord — so it is
 *     handled by the input editor directly and no file can move it. This task's title asks for it
 *     and it is not deliverable; the sheet says so rather than the helper pretending (G.33).
 *   - **Ctrl+N and Ctrl+Shift+W** are bound in transient contexts (`Footer`, `MessageSelector`) or
 *     not at all, so there is nothing in `Global` to move.
 *
 * The chords are `ctrl+x`-prefixed because that is the family Claude Code already uses for its own
 * — `ctrl+x ctrl+e`, `ctrl+x ctrl+b`, `ctrl+x ctrl+s` — and neither is taken. **`ctrl+k` is
 * deliberately not used** even though the skill's own example does: the deck claims Ctrl+K as its
 * one key away from a pane (D34), so a `ctrl+k` chord is the one prefix that never arrives.
 */
export const RECLAIMED_KEYS: readonly KeyRemap[] = [
  {
    context: 'Global',
    from: 'ctrl+t',
    to: 'ctrl+x ctrl+t',
    action: 'app:toggleTodos',
    stolenBy: 'Opens a browser tab behind the app window.',
  },
  {
    context: 'Global',
    from: 'ctrl+r',
    to: 'ctrl+x ctrl+r',
    action: 'history:search',
    stolenBy: 'Reloads the deck. Panes detach and reconnect; nothing stops.',
  },
];

/** Ctrl+W, said once, in the one place a person looking for it will be. */
export const UNRECLAIMABLE_NOTE =
  'Ctrl+W cannot be moved. Delete-word is not a keybindings action in Claude Code 2.1.278, so no ' +
  'file can rebind it — it is the input editor reading the key directly. In the browser it closes ' +
  'the window; the sessions keep running.';

/**
 * A parsed `keybindings.json`, with everything it carried that is not `bindings` kept.
 *
 * `rest` exists so a rewrite is additive in fact and not only in intent: a file with keys this
 * project has never heard of — a future `$version`, a comment key — comes back out unchanged.
 */
export interface KeybindingsFile {
  readonly bindings: readonly KeybindingContext[];
  readonly rest: Readonly<Record<string, unknown>>;
}

/**
 * Reads one, or `undefined` for anything this must not rewrite.
 *
 * Undefined means REFUSE, never "start fresh": a `keybindings.json` that does not parse, or whose
 * `bindings` is not an array, belongs to the owner and may be mid-edit. The caller distinguishes
 * that from an absent file, which is the only case where writing a new one is safe (SEC-FS-3).
 */
export function parseKeybindingsFile(text: string): KeybindingsFile | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const fields: Record<string, unknown> = { ...value };
  const raw = fields['bindings'];
  delete fields['bindings'];

  if (raw === undefined) return { bindings: [], rest: fields };
  if (!Array.isArray(raw)) return undefined;

  const blocks: KeybindingContext[] = [];
  for (const entry of raw) {
    const block = parseContext(entry);
    if (block === undefined) return undefined;
    blocks.push(block);
  }
  return { bindings: blocks, rest: fields };
}

function parseContext(value: unknown): KeybindingContext | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Record<string, unknown> = { ...value };
  const context = fields['context'];
  if (typeof context !== 'string' || context === '') return undefined;

  const bindings = parseBindings(fields['bindings']);
  return bindings === undefined ? undefined : { context, bindings };
}

function parseBindings(value: unknown): Record<string, string | null> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source: Record<string, unknown> = { ...value };
  const pairs: Record<string, string | null> = {};
  for (const key of Object.keys(source)) {
    const action = source[key];
    if (action !== null && typeof action !== 'string') return undefined;
    pairs[key] = action;
  }
  return pairs;
}

/** Reads `GET /keybindings`'s body. Anything unrecognised is `undefined` — the deck renders that. */
export function parseKeybindingPlan(value: unknown): KeybindingPlan | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const plan: unknown = (value as Record<string, unknown>)['plan'];
  if (typeof plan !== 'object' || plan === null) return undefined;
  const fields: Record<string, unknown> = { ...plan };

  if (fields['ok'] === true) return parseAccepted(fields);
  if (fields['ok'] === false) return parseRefused(fields);
  return undefined;
}

function parseAccepted(fields: Record<string, unknown>): KeybindingPlan | undefined {
  const changes = fields['changes'];
  const alreadyDone = fields['alreadyDone'];
  if (!Array.isArray(changes) || !Array.isArray(alreadyDone)) return undefined;
  const parsed = changes.map(parseFileChange);
  if (parsed.includes(undefined)) return undefined;
  return {
    ok: true,
    changes: parsed.filter((change): change is FileChange => change !== undefined),
    alreadyDone: alreadyDone.filter((path): path is string => typeof path === 'string'),
  };
}

function parseRefused(fields: Record<string, unknown>): KeybindingPlan | undefined {
  const refusals = fields['refusals'];
  if (!Array.isArray(refusals)) return undefined;
  const parsed = refusals.map(parsePlanRefusal);
  if (parsed.includes(undefined)) return undefined;
  return {
    ok: false,
    refusals: parsed.filter((refusal): refusal is PlanRefusal => refusal !== undefined),
  };
}

/** Reads `POST /keybindings`'s body. */
export function parseKeybindingWrite(value: unknown): KeybindingWrite | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Record<string, unknown> = { ...value };
  const { written, backups, alreadyDone } = fields;
  if (!Array.isArray(written) || !Array.isArray(backups) || !Array.isArray(alreadyDone)) {
    return undefined;
  }
  const strings = (list: unknown[]): readonly string[] =>
    list.filter((entry): entry is string => typeof entry === 'string');
  return {
    written: strings(written),
    backups: strings(backups),
    alreadyDone: strings(alreadyDone),
  };
}

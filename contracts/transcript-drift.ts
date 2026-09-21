// What a transcript line's TYPE has to be for this build to have seen it before — SPEC §8 R2.
//
// Split out of `transcript-record.ts` in P3-T5, when that file reached its 250-line limit. The
// seam is a real one rather than a line count: everything here is a list of what has been
// OBSERVED on this machine, and everything left there is what this build READS. The two change for
// different reasons — a Claude Code release adds to these lists, and a Flightdeck task adds to
// that union — and conflating them is what makes "a record I ignore" and "a record I have never
// seen" look identical at the parser.

/**
 * Record types seen on this machine — the P1-T7 survey of 315 transcripts, plus RESEARCH.md §C.
 *
 * This is not a list of what is parsed; it is a list of what has been **observed**, and most of it
 * is deliberately unread. Its only job is to separate "a record this build ignores" from "a record
 * this build has never seen", because those look identical at the parser and could not be less
 * alike: the first is 95 % of every transcript, and the second is the first sign that a Claude
 * Code update moved the format (SPEC §8 R2 — what `scripts/doctor` exists to catch).
 */
export const KNOWN_RECORD_TYPES: readonly string[] = [
  'agent-name',
  'agent-setting',
  'ai-title',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
  'assistant',
  'atis-latch',
  'attachment',
  'bridge-session',
  'continued-in',
  'cost-state',
  'custom-title',
  'file-history-delta',
  'file-history-snapshot',
  'frame-link',
  'last-prompt',
  'mode',
  'permission-mode',
  'pr-link',
  'pr-comment-monitor',
  'queue-operation',
  // A session whose `cwd` moved, and the worktree it was forked into. P3 wants both — they are
  // the only in-transcript evidence that two sessions are the same piece of work in two places.
  'relocated',
  'worktree-state',
  'system',
  'user',
];

/** `system` subtypes seen. A new one is drift too — `system` is a bag, not a shape. */
export const KNOWN_SYSTEM_SUBTYPES: readonly string[] = [
  'agents_killed',
  'away_summary',
  'bridge_status',
  'compact_boundary',
  'informational',
  'local_command',
  'model_consent_fallback',
  'model_refusal_fallback',
  'scheduled_task_fire',
  'stop_hook_summary',
  'turn_duration',
];

/**
 * Whether this build has seen a line of this shape before.
 *
 * A `system` record is checked by its subtype as well, because `system` is a bag rather than a
 * shape: a new subtype inside it is exactly as much drift as a new type beside it.
 */
/** Its own, because importing one from `transcript-record.ts` would be a cycle. */
function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function isKnown(type: string, fields: Readonly<Record<string, unknown>>): boolean {
  if (!KNOWN_RECORD_TYPES.includes(type)) return false;
  if (type !== 'system') return true;
  const subtype = stringAt(fields, 'subtype');
  // A `system` record with no subtype at all is a shape nobody has seen, so it is drift as well.
  return subtype !== undefined && KNOWN_SYSTEM_SUBTYPES.includes(subtype);
}

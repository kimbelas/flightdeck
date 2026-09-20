// What a session that cannot be given a terminal shows instead — P5a-T4, SPEC §5.3.
//
// **A preview is lines of plain text, and the escape sequences are gone before this shape exists.**
// `claude logs` answers with a 200x50 terminal FRAME, not a log: 330 046 bytes and 10 483 escape
// sequences for one short session, replaying 105 full-screen redraws (RESEARCH.md F.2.5, G.34). A
// naive tail of that is garbage, so core replays it through a headless xterm and sends the screen
// that is left. SEC-UI-2 is the reason it is xterm and not a hand-rolled parser — "ANSI is rendered
// by xterm.js, never by hand" — and it is also the reason the deck receives text: a preview is
// drawn in a React text node, so anything that could still be interpreted has to be gone by here.
//
// **The two sources are different KINDS of answer and the discriminator says which.** `logs` is a
// screen — what the session's terminal looks like right now. `transcript` is a trail — what it did
// recently, because the daemon is down and there is no screen to read (F.2.16). They are not
// interchangeable and the deck labels them differently; a `source` the deck ignored would be a
// deck claiming to show a screen that nobody rendered.
//
// **Every line is model- or user-written text** (SEC-UI-2). Displayed, never interpreted, never
// made actionable — the same rule the files list in session-detail.ts obeys, and for the same
// reason: a preview line came out of a session, and a session is not a trusted author.

/** Where the lines came from. `none` is an honest answer, not a failure — see `PreviewReason`. */
export type PreviewSource = 'logs' | 'transcript' | 'none';

/**
 * Why the preview is not a screen.
 *
 * A closed vocabulary rather than a sentence, so the deck owns the wording and nothing
 * model-written reaches it through this field. `undefined` when `source` is `logs` — there is
 * nothing to explain about the answer that was asked for.
 *
 * **It answers exactly one question — why there is no screen — and never why the fallback was
 * thin.** The first draft also carried `no_transcript` and `nothing_yet`, and they were wrong in a
 * way worth recording: with no daemon AND no transcript, the second overwrote the first, so a
 * machine with no `claude.exe` reported "no transcript" and buried the only actionable fact. Two
 * questions need two fields, and the second one already has one — `source: 'none'` with empty
 * `lines` is "and the fallback had nothing either", which is all the deck does with it.
 */
export type PreviewReason = 'daemon_down' | 'logs_failed' | 'no_claude';

const PREVIEW_REASONS: readonly PreviewReason[] = ['daemon_down', 'logs_failed', 'no_claude'];

const PREVIEW_SOURCES: readonly PreviewSource[] = ['logs', 'transcript', 'none'];

/**
 * The widest line a preview may carry.
 *
 * `claude logs` renders at a FIXED 200 columns by 50 rows — measured three ways in G.34: through a
 * pipe, with `COLUMNS`/`LINES` set to something else, and against the P0 capture, all 200 wide with
 * a highest cursor row of 47. So this is the frame's own width and not a guess, and a line longer
 * than it did not come off that screen.
 */
export const MAX_PREVIEW_COLUMNS = 200;

/**
 * The most lines a preview may carry.
 *
 * The frame is 50 rows and `condense` drops the blank band a fixed-height screen leaves under short
 * output, so a real one is nearer twenty. The cap is what stops a transcript trail growing without
 * bound, and it is above 50 so that a screen is never the thing it truncates.
 */
export const MAX_PREVIEW_LINES = 64;

export interface SessionPreview {
  readonly sessionId: string;
  /** When core read it, epoch ms — so the deck can say how old a preview is. Never refreshed. */
  readonly at: number;
  readonly source: PreviewSource;
  /** Top to bottom. A screen's rows in order, or a trail oldest-first. */
  readonly lines: readonly string[];
  readonly reason: PreviewReason | undefined;
}

/**
 * One preview body, or `undefined` if it is not one.
 *
 * `sessionId` is the only required field, for the reason `parseSessionDetail` gives: it is the only
 * one that says which row this belongs to. The caps are re-applied HERE and not only where the
 * lines were produced, because this is the SEC-UI-2 boundary — a deck that took core's word for
 * the length of a model-written line would be trusting a socket.
 *
 * @throws never.
 */
export function parseSessionPreview(value: unknown): SessionPreview | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const sessionId = fields['sessionId'];
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  const at = fields['at'];
  const reason = PREVIEW_REASONS.find((known) => known === fields['reason']);
  return {
    sessionId,
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    source: PREVIEW_SOURCES.find((known) => known === fields['source']) ?? 'none',
    lines: linesOf(fields['lines']),
    reason,
  };
}

/** Strings only, trimmed of the trailing padding a fixed-width screen leaves, and capped both ways. */
function linesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line: unknown): line is string => typeof line === 'string')
    .slice(0, MAX_PREVIEW_LINES)
    .map((line) => line.slice(0, MAX_PREVIEW_COLUMNS).trimEnd());
}

/**
 * A screen's rows, reduced to the ones worth showing.
 *
 * Three steps, and each is about the same artefact: `claude logs` renders a FIXED 50-row frame, so
 * a session that has printed eight lines still sends fifty, forty of them blank. Trailing padding
 * per row goes, the blank band above and below goes, and an interior run of blanks collapses to
 * one — a screen that is 60 % padding is a fact about the frame's height, not about the session.
 *
 * Shared by both sources because the deck must not be able to tell them apart by their whitespace.
 *
 * @throws never.
 */
export function condense(rows: readonly string[]): readonly string[] {
  const trimmed = rows.map((row) => row.slice(0, MAX_PREVIEW_COLUMNS).trimEnd());
  const kept: string[] = [];
  for (const row of trimmed) {
    if (row === '' && kept.at(-1) === '') continue;
    kept.push(row);
  }
  while (kept.length > 0 && kept[0] === '') kept.shift();
  while (kept.length > 0 && kept.at(-1) === '') kept.pop();
  return kept.slice(-MAX_PREVIEW_LINES);
}

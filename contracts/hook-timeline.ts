// `.claude/settings.json → hooks`, flattened into the timeline SPEC §5.1 asks for — P3-T3.
//
// **SPEC calls it a trigger timeline and the word is doing work.** The file is three levels of
// nesting — event → a list of matcher groups → a list of commands — and reading it as a tree is
// how a person ends up counting braces to answer "what runs when I edit a `.ts`". Flattened, it is
// one row per thing that can run, and the three questions a row has to answer (when, whether,
// what) are three of its fields. The acceptance target has 17 scripts across 5 events; as a tree
// that is 17 leaves at depth three, and as a list it is 17 rows.
//
// **Order is the timeline and is preserved exactly.** Claude Code runs a matcher group's commands
// in the order they are written, and two `PostToolUse` entries where the second depends on the
// first having run is a real configuration. Sorting these rows — by event, by script, by anything —
// would turn a sequence into a set and quietly answer a different question.
//
// **`async` and `timeout` are the badges SPEC names, and they are opposites worth seeing.** An
// `async: true` hook does not block the tool call and has no timeout to report; a synchronous one
// holds the session for up to `timeout` seconds, and 17 of those at 10 s each is a number somebody
// should be able to see without opening the file.
//
// **An unknown shape degrades to fewer rows, never to a throw.** `settings.json` belongs to
// Claude Code and grows fields between releases; this is the same rule `agents-listing.ts`
// follows, and for the stronger reason that the file being read here is one an imported repository
// controls (SEC-FS-1).

/** One thing that can run, and everything about when. See the header on flattening. */
export interface HookStep {
  /** `PreToolUse`, `SessionStart`, … — the key it was found under, not validated against a list. */
  readonly event: string;
  /**
   * The tool or source pattern this group matches, or `undefined` for a group with none.
   *
   * Absent means "every time this event fires", which is a materially different row from
   * `Edit|Write|MultiEdit` and is why this is not defaulted to `*`. `PreCompact` in the acceptance
   * target is exactly that shape.
   */
  readonly matcher: string | undefined;
  /**
   * The `if:` guard, as written — a glob condition on the edited file in the measured targets.
   *
   * A second, finer gate that runs after the matcher, and it is why matcher alone does not answer
   * "what runs when I edit a `.scss`": four commands share one `Edit|Write|MultiEdit` matcher and
   * only one of them has the condition that lets it through.
   */
  readonly condition: string | undefined;
  /**
   * What runs, as written in the file.
   *
   * The whole command rather than the script name, because `$CLAUDE_PROJECT_DIR` and the
   * interpreter are part of what somebody auditing hooks is looking at. Capped, and the cap is the
   * reason it is safe to show: this string comes out of a file the repository controls, and the
   * deck renders it as text (§11 — no `dangerouslySetInnerHTML`).
   */
  readonly command: string;
  /** Does not block the tool call. Mutually exclusive with a meaningful `timeoutSeconds`. */
  readonly async: boolean;
  /** How long the session waits, in seconds. `undefined` when the file does not say. */
  readonly timeoutSeconds: number | undefined;
}

/**
 * How much of `settings.json` is read.
 *
 * The largest measured is a few KB. A quarter of a megabyte is room for one that grew by an order
 * of magnitude and a bound on what a repository can make core parse in one request.
 */
export const MAX_SETTINGS_BYTES = 256 * 1024;

/** A command line, not a script. Long enough for every measured one, short enough to draw. */
const MAX_COMMAND_CHARS = 400;

/** An event name and a matcher are labels. */
const MAX_LABEL_CHARS = 200;

/**
 * More rows than any configuration a person maintains by hand.
 *
 * The acceptance target has 17. A file with more than this in it is generated, and drawing all of
 * them would be the panel's slowest moment for a list nobody reads to the end.
 */
const MAX_STEPS = 200;

/**
 * Every hook in the file, in the order it would run.
 *
 * @param settings the parsed `settings.json`, or anything else. A file that is not an object, or
 * whose `hooks` is not one, has no hooks — the same answer as a file with none, because the two
 * draw the same empty section and a panel is not the place to report a malformed config.
 * @throws never.
 */
export function readHookTimeline(settings: unknown): readonly HookStep[] {
  const hooks = field(settings, 'hooks');
  if (hooks === undefined) return [];
  const steps: HookStep[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      collect(steps, event.slice(0, MAX_LABEL_CHARS), group);
      if (steps.length >= MAX_STEPS) return steps.slice(0, MAX_STEPS);
    }
  }
  return steps;
}

/** Every step from a `GET /projects/map` body, dropping what it cannot read. @throws never. */
export function parseHookSteps(value: unknown): readonly HookStep[] {
  if (!Array.isArray(value)) return [];
  const steps: HookStep[] = [];
  for (const entry of value) {
    const step = parseHookStep(entry);
    if (step !== undefined) steps.push(step);
  }
  return steps.slice(0, MAX_STEPS);
}

/** One matcher group's commands, appended in file order. */
function collect(steps: HookStep[], event: string, group: unknown): void {
  const fields = field(group, undefined);
  if (fields === undefined) return;
  const matcher = label(fields['matcher']);
  const commands = fields['hooks'];
  if (!Array.isArray(commands)) return;
  for (const entry of commands) {
    const step = stepOf(event, matcher, entry);
    if (step !== undefined) steps.push(step);
  }
}

/**
 * One command entry.
 *
 * `type` is not checked against `'command'`: a future hook type would be a row worth showing with
 * whatever it does say, and refusing it here would hide a hook that runs.
 */
function stepOf(event: string, matcher: string | undefined, entry: unknown): HookStep | undefined {
  const fields = field(entry, undefined);
  if (fields === undefined) return undefined;
  const command = fields['command'];
  if (typeof command !== 'string' || command === '') return undefined;
  return {
    event,
    matcher,
    condition: label(fields['if']),
    command: command.slice(0, MAX_COMMAND_CHARS),
    async: fields['async'] === true,
    timeoutSeconds: seconds(fields['timeout']),
  };
}

/** One step, from the wire. The event and the command are what make a row worth drawing. */
function parseHookStep(value: unknown): HookStep | undefined {
  const fields = field(value, undefined);
  if (fields === undefined) return undefined;
  const event = fields['event'];
  const command = fields['command'];
  if (typeof event !== 'string' || event === '') return undefined;
  if (typeof command !== 'string' || command === '') return undefined;
  return {
    event: event.slice(0, MAX_LABEL_CHARS),
    matcher: label(fields['matcher']),
    condition: label(fields['if'] ?? fields['condition']),
    command: command.slice(0, MAX_COMMAND_CHARS),
    async: fields['async'] === true,
    timeoutSeconds: seconds(fields['timeoutSeconds'] ?? fields['timeout']),
  };
}

/**
 * An object's own entries, or `undefined` for anything that is not one.
 *
 * @param key when given, the named child rather than the object itself.
 */
function field(value: unknown, key: string | undefined): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (key === undefined) return fields;
  return field(fields[key], undefined);
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_LABEL_CHARS) : undefined;
}

/** A positive, finite number of seconds. A `0`, a string or a negative is no timeout at all. */
function seconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

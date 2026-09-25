// A subagent, a slash command or a skill, as the head of its own markdown file — P3-T3, SPEC §5.1.
//
// Three rows of SPEC §5.1's table and one type, because the three files are the same file. An
// agent is `.claude/agents/<name>.md`, a command is `.claude/commands/<name>.md` and a skill is
// `.claude/skills/<name>/SKILL.md`; all three open with a `---` fenced block carrying `name`,
// `description` and some subset of `model`, `tools`/`allowed-tools` and `argument-hint`. Three
// types over one shape would be three parsers to keep in step for the sake of a discriminator that
// is already a field.
//
// **The parser is deliberately not a YAML parser.** Every frontmatter block measured across the
// acceptance targets — 16 `name`, 19 `description`, 12 `allowed-tools`, 3 `tools`, 3 `model` — is
// `key: value` on one line with an inline scalar, and nothing uses a block list, an anchor or a
// nested map. A YAML dependency would buy the ability to read a file nobody writes, at the price
// of running a general-purpose parser over a file an imported repository controls. What a line
// reader cannot understand it ignores, which is the right failure: a missing `model` badge, not a
// missing agent.
//
// **`description` is the trigger text SPEC asks for.** It is what Claude Code itself matches a
// request against, so it is the one field that says when a skill fires — which makes it the field
// worth showing and the reason a nameless entry is still worth listing.
//
// **Nothing here opens anything.** It is handed the first few KB of a file by the reader that
// resolved and screened the path (`ClaudeAssetReader`), and it is tested with a string.

/** Which of the three an entry is. The discriminator, and the heading it is drawn under. */
export const ASSET_KINDS = ['agent', 'command', 'skill'] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * How much of an asset file is read.
 *
 * The frontmatter is the first thing in the file and is a few hundred bytes; a skill's body runs
 * to thousands of lines and none of it is displayed. Reading the head is what keeps listing ten
 * skills ten small reads rather than a megabyte.
 */
export const MAX_ASSET_HEAD_BYTES = 4096;

/** Long enough for the longest `description` measured (a paragraph), short enough to bound a row. */
const MAX_FIELD_CHARS = 400;

/** A name is a filename-shaped label, never a sentence. */
const MAX_NAME_CHARS = 120;

/**
 * `description: >` followed by indented lines — the one multi-line form measured, in a plugin's
 * agent (`shell-review`'s `bash-script-auditor`, P9-T5). Read as a line it was the description
 * `>`; folded, it is the paragraph the author wrote. Anything richer is still ignored.
 */
const BLOCK_SCALAR = /^[>|][+-]?$/u;

/** An agent lists a handful. A file claiming two hundred tools is not one this panel will draw. */
const MAX_TOOLS = 32;

export interface ClaudeAsset {
  readonly kind: AssetKind;
  /**
   * The frontmatter's `name`, falling back to the filename.
   *
   * The fallback is not a convenience: Claude Code itself addresses a command by its FILENAME, so
   * a `design-check.md` with no `name:` really is `/design-check`, and a panel that dropped it for
   * missing a field would be hiding a command that works. Every command measured across the
   * acceptance targets is exactly that shape — 12 `argument-hint` against 16 `name` over 19 files.
   */
  readonly name: string;
  /** The trigger text — see the header. `undefined` for a file with no `description:`. */
  readonly description: string | undefined;
  /** `inherit`, a model id, or `undefined`. Passed through as written; core does not resolve it. */
  readonly model: string | undefined;
  /** `tools` for an agent, `allowed-tools` for a command or a skill. Empty means unrestricted. */
  readonly tools: readonly string[];
  /**
   * The plugin that ships it, or absent for the project's own `.claude` — P9-T5.
   *
   * Absent rather than `undefined` so every asset that predates plugins keeps exactly its shape.
   * Claude Code addresses a plugin's asset by its SCOPED name, `<plugin>:<name>` — the skill
   * `skills/review/SKILL.md` in `my-plugin` runs as `/my-plugin:review`, and its agent
   * `agents/reviewer.md` is `my-plugin:reviewer` (code.claude.com/docs/en/plugins/components).
   * `scopedAssetName` is the one place that joins the two.
   */
  readonly plugin?: string;
}

/**
 * What a plugin name may look like — P9-T5.
 *
 * Kebab case, which is what Claude Code's manifest asks of a plugin name ("kebab-case, no
 * spaces"). It is the prefix of a slash line and of an `--agent` value, so a name that needs
 * escaping in either is dropped where it is read rather than escaped where it is used.
 */
export const PLUGIN_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/**
 * The name Claude Code knows the asset by: `name` for the project's own, `<plugin>:<name>` for a
 * plugin's. The slash line a skill runs as is `/` and this; an agent's `--agent` value is this.
 */
export function scopedAssetName(asset: ClaudeAsset): string {
  return asset.plugin === undefined ? asset.name : `${asset.plugin}:${asset.name}`;
}

/**
 * One asset from the head of its file.
 *
 * @param kind which of the three directories it came out of — known from the path, never guessed
 * from the contents.
 * @param fallbackName the filename without its extension, for a file with no `name:`. See `name`.
 * @param head the first `MAX_ASSET_HEAD_BYTES` of the file, or `undefined` if it could not be read.
 * @returns the asset, or `undefined` for a file with no frontmatter block at all — which is a file
 * Claude Code would not load either.
 * @throws never.
 */
export function parseAsset(
  kind: AssetKind,
  fallbackName: string,
  head: string | undefined,
): ClaudeAsset | undefined {
  if (head === undefined) return undefined;
  const fields = frontmatter(head);
  if (fields === undefined) return undefined;
  const name = fields.get('name') ?? fallbackName;
  if (name === '') return undefined;
  return {
    kind,
    name: name.slice(0, MAX_NAME_CHARS),
    description: fields.get('description')?.slice(0, MAX_FIELD_CHARS),
    model: fields.get('model')?.slice(0, MAX_NAME_CHARS),
    tools: toolList(fields.get('tools') ?? fields.get('allowed-tools')),
  };
}

/** One asset, from a `GET /projects/map` body. @throws never. */
export function parseClaudeAsset(value: unknown): ClaudeAsset | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const raw = fields['kind'];
  const name = fields['name'];
  if (typeof name !== 'string' || name === '') return undefined;
  if (typeof raw !== 'string') return undefined;
  // `find` over the tuple narrows to `AssetKind` without a cast — a kind this build does not know
  // is dropped rather than drawn under a heading that does not exist (§11 rule 1).
  const kind = ASSET_KINDS.find((known) => known === raw);
  if (kind === undefined) return undefined;
  const plugin = fields['plugin'];
  const asset: ClaudeAsset = {
    kind,
    name: name.slice(0, MAX_NAME_CHARS),
    description: text(fields['description']),
    model: text(fields['model']),
    tools: wireTools(fields['tools']),
  };
  // A plugin name that is not `PLUGIN_SHAPE` drops the ASSET, not just the field: kept without it,
  // a plugin's skill would be drawn as the project's own and press as a slash line that runs
  // nothing.
  if (plugin === undefined) return asset;
  return typeof plugin === 'string' && PLUGIN_SHAPE.test(plugin) ? { ...asset, plugin } : undefined;
}

/**
 * The `---` fenced block at the top of the file, as `key → value`.
 *
 * Keys are matched at the start of a line only, so a `description:` inside a fenced code block in
 * the body cannot be read as a field — the block ends at the first closing `---`, and the body is
 * never looked at.
 *
 * @returns `undefined` when the file does not open with a fence. A file whose head was truncated
 * mid-block still parses: the lines that did arrive are the ones that matter, and the fence being
 * absent from a 4 KB head means the block is longer than any measured one.
 */
function frontmatter(head: string): Map<string, string> | undefined {
  const lines = head.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  const fields = new Map<string, string>();
  const body = lines.slice(1);
  const end = body.findIndex((line) => line.trim() === '---');
  const block = end === -1 ? body : body.slice(0, end);
  block.forEach((line, index) => {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/.test(line)) return;
    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    const value = BLOCK_SCALAR.test(raw) ? folded(block, index + 1) : unquote(raw);
    if (key !== '' && value !== '') fields.set(key, value);
  });
  return fields;
}

/** The indented lines after `start`, trimmed and joined with spaces — YAML's folding, roughly. */
function folded(block: readonly string[], start: number): string {
  const parts: string[] = [];
  for (const line of block.slice(start)) {
    if (!/^\s/.test(line) && line.trim() !== '') break;
    if (line.trim() !== '') parts.push(line.trim());
  }
  return parts.join(' ');
}

/** `"<route> [--ref=…]"` and `'…'` both appear in the measured files. Neither quote is content. */
function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/** `Read, Grep, Glob` — comma-separated, which is the only form measured. Empty stays empty. */
function toolList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((tool) => tool.trim().slice(0, MAX_NAME_CHARS))
    .filter((tool) => tool !== '')
    .slice(0, MAX_TOOLS);
}

/** A wire string, capped. Anything else — a number, a null, an object — is absent. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_FIELD_CHARS) : undefined;
}

/** The wire's own array, kept to the strings in it. A non-array is no tools rather than a refusal. */
function wireTools(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const tools: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '') tools.push(entry.slice(0, MAX_NAME_CHARS));
  }
  return tools.slice(0, MAX_TOOLS);
}

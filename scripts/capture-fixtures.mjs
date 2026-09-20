// Scrubs raw captures in fixtures/raw/** into committable fixtures under fixtures/<source>/.
// CODING-STANDARDS.md §10.3. Raw captures never enter the repo; these outputs do.
//
//   node scripts/capture-fixtures.mjs            scrub every raw capture
//   node scripts/capture-fixtures.mjs --check    fail if any output would change (CI)
//
// One file under `fixtures/` is NOT written by this script and says so in its name: a
// `*.screen.txt` beside a frame is the screen that frame flattens to, committed as a golden and
// compared by `tests/fixtures/logs.test.ts`. It is deliberately not regenerated here — a golden
// rewritten by the code it checks proves nothing (P5a-T4).
//
// Rule: every string longer than 12 characters is replaced by a deterministic placeholder that
// preserves the *shape* a parser cares about — a UUID stays a parseable UUID, a Windows path
// stays a Windows path of the same depth and extension. Deterministic means the same input
// always yields the same placeholder, so a re-capture produces a zero-line diff unless the
// upstream shape actually changed.
//
// Path segments are the exception, and do not use the length rule at all: a segment survives
// only if it is named in STRUCTURAL_SEGMENTS. Length was never a safety property — the account
// name and every project folder on this machine are under 12 characters, so the old rule wrote
// them into every committed fixture (RESEARCH.md F.7.8).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW_ROOT = join(ROOT, 'fixtures', 'raw');
const MAX_CLEAR_TEXT = 12;

// Enum-like vocabulary: short, fixed, non-sensitive, and the thing fixtures exist to assert on.
// Scrubbing these would make a fixture unable to test the mapping it was captured for.
const VOCABULARY_KEYS = new Set([
  'hook_event_name',
  'source',
  'permission_mode',
  'model',
  'type',
  'subtype',
  'content-type',
  'accept',
  'accept-encoding',
  'connection',
  'user-agent',
  'host',
]);

// Keys this script writes itself while curating a capture. They are documentation, not observed
// data, so they are never scrubbed.
const AUTHORED_KEYS = new Set(['claude_version', 'transport', 'session_kind', 'note']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
// An ISO-8601 instant is a shape a parser cares about: scrubbing it to text- makes any fixture
// that exercises date handling untestable. The value is still hidden; only the shape survives.
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
// CLI flags are a closed, non-sensitive vocabulary (SECURITY.md SEC-PROC-2 allowlists them).
// Their *values* are not, and stay subject to the length rule.
const CLI_FLAG_PATTERN = /^--?[a-z][a-z0-9-]*$/;
// Model ids are the same kind of thing: a closed, published, non-sensitive vocabulary, and the
// statusline fixtures exist partly to assert the id → avatar mapping (RESEARCH.md F.3.5). The
// key is `id` nested under `model`, which VOCABULARY_KEYS cannot express without also unscrubbing
// every other `id` in every fixture.
const MODEL_ID_PATTERN = /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\[1m\])?$/;

function digest(value, length) {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function fakeUuid(value) {
  const hex = digest(value, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Keep it a well-formed v4 so zod's .uuid() and any regex in contracts/ still accept it.
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

// Path segments that describe the *structure* of a Windows or Claude install rather than who
// owns it: the OS directories every machine has, and the Claude layout a parser navigates by
// name. None of them identify a person, an employer or a client, and a fixture that loses them
// loses the shape it was captured to assert on. Everything else in a path is scrubbed however
// short it is — the account name, project folders, worktree and scratch directory names.
export const STRUCTURAL_SEGMENTS = new Set([
  'Users',
  'AppData',
  'Local',
  'LocalLow',
  'Roaming',
  'Temp',
  'Documents',
  'Desktop',
  'Downloads',
  'claude',
  'projects',
  'scratchpad',
  'shell-snapshots',
  'todos',
  'statsig',
  'jobs',
  'daemon',
  'logs',
  'worktrees',
  '.claude',
  '.claude-365',
  '.claude-isg',
  '.git',
]);

function fakePath(value) {
  const separator = value.includes('\\') ? '\\' : '/';
  const segments = value.split(/[\\/]/);
  const scrubbed = segments.map((segment, index) => {
    // Only a real drive letter is kept as one. A relative path — which is what every
    // `trackedFileBackups` key is — has a project folder in segment 0, and rewriting that to
    // `C:` would both lose the shape and keep the name.
    if (index === 0 && /^[A-Za-z]:$/.test(segment)) return 'C:';
    if (segment === '' || STRUCTURAL_SEGMENTS.has(segment)) return segment;
    const extension = /\.[A-Za-z0-9]+$/.exec(segment);
    return `path-${digest(segment, 6)}${extension ? extension[0] : ''}`;
  });
  return scrubbed.join(separator);
}

// A constant shift, so a scrubbed capture keeps both the ordering and the gaps between its
// instants -- a timeline fixture is about sequence, and a hash-derived date would shuffle it.
// The absolute date is what gets hidden; the capture date lives in RESEARCH.md instead.
const INSTANT_SHIFT_MS = 6 * 365 * 24 * 60 * 60 * 1000;

function fakeInstant(value) {
  return new Date(Date.parse(value) - INSTANT_SHIFT_MS).toISOString();
}

function scrubString(value) {
  if (value.length <= MAX_CLEAR_TEXT) return value;
  if (CLI_FLAG_PATTERN.test(value)) return value;
  if (MODEL_ID_PATTERN.test(value)) return value;
  if (ISO_INSTANT_PATTERN.test(value)) return fakeInstant(value);
  if (UUID_PATTERN.test(value)) return fakeUuid(value);
  if (WINDOWS_PATH_PATTERN.test(value)) return fakePath(value);
  return `text-${digest(value, 8)}`;
}

// `claude agents --json` prints the short id as the first segment of the session uuid. The two
// fields scrub independently -- the short one is under the length limit and survives intact, the
// uuid does not -- so the relationship has to be restored or no fixture can assert on it.
function keepShortIdDerivable(original, scrubbed) {
  const { id, sessionId } = original;
  if (typeof id !== 'string' || typeof sessionId !== 'string') return scrubbed;
  if (!sessionId.startsWith(id)) return scrubbed;
  return { ...scrubbed, id: String(scrubbed.sessionId).slice(0, id.length) };
}

// Free text a person or the model wrote (SEC-UI-2), scrubbed however short it is. The length
// rule does not protect these: a session named after a ticket says who the owner works for in
// nine characters. `name` is too overloaded a key to list here — `output_style.name` is
// vocabulary the statusline fixtures assert on — so it is handled by scrubSessionName below,
// which keys off the record the name belongs to rather than off the field alone.
const FREE_TEXT_KEYS = new Set([
  'detail',
  'intent',
  'result',
  'session_name',
  'session_title',
  // Transcript records (P1-T7). Every one of these is text a person or the model wrote, and the
  // length rule protects none of them: `gitBranch` is routinely a ticket id, and an `aiTitle` is
  // one sentence about what the owner was actually doing. `content` is the away_summary recap —
  // the single most identifying field in the whole transcript, and the one the deck wants most.
  'aiTitle',
  'customTitle',
  'agentName',
  'lastPrompt',
  'atis',
  'content',
  'gitBranch',
  'title',
  'text',
]);

// A session record — anything carrying a pid or a sessionId — has a user-chosen `name`, and that
// is free text like the keys above. Deciding from the parent object keeps `output_style.name`
// and any other vocabulary `name` readable.
function scrubSessionName(original, scrubbed) {
  if (!('pid' in original) && !('sessionId' in original)) return scrubbed;
  if (typeof original.name !== 'string') return scrubbed;
  return { ...scrubbed, name: `text-${digest(original.name, 8)}` };
}

// Objects whose KEYS are data rather than field names. `daemon/roster.json`'s `workers` is the
// first one captured: each key is the short session id, and it is the same short-id relationship
// keepShortIdDerivable restores between `id` and `sessionId`. Scrubbing the values and leaving the
// keys alone produced a fixture asserting a relationship it no longer had — worse than an
// unscrubbed one, because a parser built against it would have been built against a lie (P0-T9).
const DATA_KEYED_OBJECTS = new Set(['workers']);

// Objects whose keys are PATHS. `file-history-snapshot.trackedFileBackups` is keyed by the file
// each backup is of, and the first transcript capture put a whole client project tree — every
// component, every vault card, and one absolute path through the account name — into the fixture
// verbatim, because nothing here has ever scrubbed a key (P1-T7).
//
// That is the same bug as P0-T9's `workers`, which is why the guard below exists as well as this
// fix: a set that has to be extended by hand every time Claude Code adds a data-keyed object is a
// rule that is one release behind, and the leak is silent until someone reads a fixture.
const PATH_KEYED_OBJECTS = new Set(['trackedFileBackups']);

function rekeyByPath(scrubbed) {
  return Object.fromEntries(
    Object.entries(scrubbed).map(([path, value]) => [fakePath(path), value]),
  );
}

// A key that contains a separator, a drive letter or whitespace is DATA, not a field name — no
// JSON API names a field `groundwork\components\board\Card.tsx`. Field names that are merely
// long (`cumulativeDroppedTokens`) pass; model ids, short ids and uuids pass. Anything that trips
// this is a data-keyed object nobody has classified, and the capture fails rather than writing it.
const DATA_KEY_PATTERN = /[\\/]|^[A-Za-z]:|\s/;

function assertNoDataKeys(node, trail, parentKey) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      assertNoDataKeys(item, `${trail}[${String(index)}]`, undefined);
    });
    return;
  }
  if (node === null || typeof node !== 'object') return;
  // A classified object's own keys are data on purpose and have a scrubber; only its values are
  // still worth walking. Checking the raw record rather than the scrubbed one is what makes this
  // a test of classification instead of a test of output shape — a scrubbed path key still looks
  // exactly like a path, which is the whole point of keeping the shape.
  const classified =
    parentKey !== undefined &&
    (PATH_KEYED_OBJECTS.has(parentKey) || DATA_KEYED_OBJECTS.has(parentKey));
  for (const [key, value] of Object.entries(node)) {
    if (!classified && DATA_KEY_PATTERN.test(key)) {
      throw new Error(
        `unscrubbed data key at ${trail}: ${JSON.stringify(key)} — add its parent to ` +
          `PATH_KEYED_OBJECTS or DATA_KEYED_OBJECTS in scripts/capture-fixtures.mjs`,
      );
    }
    assertNoDataKeys(value, `${trail}.${key}`, key);
  }
}

function rekeyByShortId(scrubbed) {
  return Object.fromEntries(
    Object.entries(scrubbed).map(([id, worker]) => {
      const sessionId = worker === null ? undefined : worker?.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length < id.length) return [id, worker];
      return [sessionId.slice(0, id.length), worker];
    }),
  );
}

export function scrub(node, key) {
  if (Array.isArray(node)) return node.map((item) => scrub(item, key));
  if (node !== null && typeof node === 'object') {
    const scrubbed = Object.fromEntries(
      Object.entries(node).map(([name, value]) => [name, scrub(value, name)]),
    );
    if (key !== undefined && DATA_KEYED_OBJECTS.has(key)) return rekeyByShortId(scrubbed);
    if (key !== undefined && PATH_KEYED_OBJECTS.has(key)) return rekeyByPath(scrubbed);
    return scrubSessionName(node, keepShortIdDerivable(node, scrubbed));
  }
  if (typeof node !== 'string') return node;
  if (key !== undefined && AUTHORED_KEYS.has(key)) return node;
  // An empty string is not free text, it is an absent value with a key — and replacing it with a
  // placeholder would have a fixture assert content that was never in the capture.
  if (key !== undefined && FREE_TEXT_KEYS.has(key) && node !== '') return `text-${digest(node, 8)}`;
  if (key !== undefined && VOCABULARY_KEYS.has(key)) return value12(node);
  return scrubString(node);
}

// Vocabulary values are kept verbatim, but a surprisingly long one is still scrubbed — a field
// that is supposed to be an enum and arrives as a paragraph is not vocabulary.
function value12(text) {
  return text.length <= 40 ? text : scrubString(text);
}

// ---------------------------------------------------------------------------------------------
// Terminal frames — `.txt` captures. P5a-T4.
//
// `claude logs` answers with a 200x50 terminal FRAME: 330 046 bytes, 4 724 lines and 10 483 escape
// sequences for one short session, replaying 105 full-screen redraws (RESEARCH.md F.2.5, G.34).
// None of the rules above apply to it, and D28 is the reason this path waited for a consumer
// rather than being guessed at in P0: "what matters in the frame is a question only a consumer can
// answer", and the consumer is now `HeadlessScreenReader`, which replays the frame on a screen and
// reads the rows off it.
//
// **So what a parser needs here is not shape, it is LENGTH.** Every glyph advances the cursor one
// cell and the frame relies on autowrap — its 200-character rules carry no newline and wrap onto
// the next row — so a placeholder one character longer or shorter than what it replaces reflows
// every row below it. That is the inverse of the JSON rules, where `text-<8 hex>` may be any length
// because a parser reads a field by name. A fixture scrubbed by those rules would still LOOK like a
// terminal frame and would flatten to a screen that was never on anybody's terminal.
//
// The rule that falls out of it:
//
//   - escape sequences and control characters pass through **byte for byte** — they are the
//     structure, and 39 distinct ones carry the whole layout;
//   - every ASCII letter and digit is replaced by one of the same class, in place;
//   - everything else — spaces, punctuation, and the box-drawing and spinner glyphs Claude Code
//     draws its chrome with — passes through, because none of it is identity and all of it is
//     what makes the flattened screen recognisable.
//
// **The filler is derived from POSITION and LENGTH, never from the word.** That is the one place
// this deliberately breaks the determinism rule the JSON scrubber follows, and it is a
// disclosure decision rather than a style: `text-<sha256 prefix>` of a whole sentence is a big
// search space, but a per-WORD hash of a 4 000-word screen is a substitution cipher anyone can
// undo with a dictionary and one `sha256` per guess. Keying on the slot instead means the output
// is a function of the punctuation, the escapes and the lengths — it never reads the letters — so
// there is nothing to guess against. Re-scrubbing the same capture still yields the same bytes,
// which is all `--check` needs.
const FRAME_SEQUENCE = new RegExp(
  // OSC (ends at BEL or ST), then CSI, then the two-character escapes. In that order, because CSI
  // would otherwise match the `[`-less tail of an OSC string and split it in half.
  // Matching control characters IS the job here: ESC introduces every sequence in the frame and
  // BEL terminates an OSC string.
  // eslint-disable-next-line no-control-regex
  '\u001b\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)|\u001b\\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\\\-_]',
  'g',
);

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGIT_CHARS = '0123456789';

/**
 * One run of letters and digits, replaced in place.
 *
 * Class is preserved per character rather than per run, so a uuid comes out uuid-shaped, `v2.1.267`
 * comes out version-shaped and `$0.03` comes out money-shaped. That leaks the shape, which is the
 * same order of information as the length this has to preserve anyway, and it is what makes the
 * committed fixture reviewable as a screen instead of as a wall of one letter.
 */
function fillRun(run, at) {
  const bytes = createHash('sha256')
    .update(`${String(at)}:${String(run.length)}`)
    .digest();
  let filled = '';
  for (let index = 0; index < run.length; index += 1) {
    const character = run[index];
    const pick = bytes[index % bytes.length];
    if (character >= '0' && character <= '9') filled += DIGIT_CHARS[pick % 10];
    else if (character >= 'A' && character <= 'Z') filled += UPPERCASE[pick % 26];
    else filled += LOWERCASE[pick % 26];
  }
  return filled;
}

function isAsciiAlphanumeric(character) {
  return (
    (character >= '0' && character <= '9') ||
    (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z')
  );
}

/**
 * The printable text between two escape sequences.
 *
 * **A non-ASCII letter or digit fails the capture rather than being replaced.** Every non-ASCII
 * character in the captures measured so far is chrome — box drawing, spinners, arrows, `·` — and
 * none of it is identity. A letter from another script would be, and the honest options are both
 * bad: leaving it is a leak, and swapping it for an ASCII one changes the cell width of a wide
 * glyph and reflows the screen this whole path exists to preserve. So it stops, the way
 * `assertNoDataKeys` stops on an unclassified key, and names the offset so the next person can
 * decide with the character in front of them.
 */
function scrubFrameText(text, offset) {
  let out = '';
  let run = '';
  let runAt = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (isAsciiAlphanumeric(character)) {
      if (run === '') runAt = offset + index;
      run += character;
      continue;
    }
    if (run !== '') {
      out += fillRun(run, runAt);
      run = '';
    }
    if (character.codePointAt(0) >= 128 && /\p{L}|\p{N}/u.test(character)) {
      throw new Error(
        `non-ASCII letter or digit at offset ${String(offset + index)}: ` +
          `${JSON.stringify(character)} — decide how to replace it WITHOUT changing its cell ` +
          `width before scrubbing this capture`,
      );
    }
    out += character;
  }
  if (run !== '') out += fillRun(run, runAt);
  return out;
}

/**
 * One terminal frame, scrubbed.
 *
 * @throws when the capture carries no escape sequence at all. A `.txt` with no ANSI in it is not a
 * terminal frame, and scrubbing it by these rules would be this script guessing what a file is —
 * which is what `DEFERRED` exists to stop it doing quietly.
 */
export function scrubFrame(raw) {
  let out = '';
  let last = 0;
  let sequences = 0;
  FRAME_SEQUENCE.lastIndex = 0;
  let match;
  while ((match = FRAME_SEQUENCE.exec(raw)) !== null) {
    out += scrubFrameText(raw.slice(last, match.index), last);
    out += match[0];
    last = match.index + match[0].length;
    sequences += 1;
  }
  out += scrubFrameText(raw.slice(last), last);
  if (sequences === 0) {
    throw new Error('no escape sequences — this is not a terminal frame, so it has no scrub rule');
  }
  return out;
}

// Raw captures this script knowingly cannot scrub, each with the task that will handle it.
//
// The list exists because the alternative is worse in both directions. Silently ignoring a file
// it cannot parse is what this script used to do: it reported "11 raw capture(s)" against twelve
// files on disk, `--check` passed, and a shape captured in P0 was absent from the repo for a day
// without anything saying so (P0-T9). Failing outright instead would redden CI over a file nobody
// has decided how to scrub yet. So a deferral is allowed but must be WRITTEN DOWN, and anything
// not on the list is an error — a new unscrubbable capture cannot arrive quietly.
//
// **Empty is the state it is supposed to be in.** `logs-blocked.txt` was the only entry and it is
// gone, paid off by the path above. The map stays because the rule does: the next shape nobody has
// a consumer for gets a line here with its task id, not a silent skip.
const DEFERRED = new Map([]);

function listRawFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listRawFiles(path);
    return [path];
  });
}

/** Splits the captures into ones this script scrubs, ones it defers, and ones nobody decided. */
function triage(files) {
  const scrubbable = [];
  const deferred = [];
  const unhandled = [];
  for (const file of files) {
    const name = basename(file);
    // `.txt` is a terminal frame (P5a-T4). The extension is the whole classification, and
    // `scrubFrame` is what makes that safe rather than a guess: a `.txt` with no escape sequence
    // in it fails the capture instead of being scrubbed by rules written for something else.
    if (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.txt')) {
      scrubbable.push(file);
    } else if (DEFERRED.has(name)) deferred.push(file);
    else unhandled.push(file);
  }
  return { scrubbable, deferred, unhandled };
}

/**
 * One capture, scrubbed, as the text to write.
 *
 * JSONL is scrubbed **per line and re-printed compact**, because in that format the newline is
 * the record separator — pretty-printing a transcript would turn every record into a document no
 * line-oriented reader could get back, and a line-oriented reader is exactly what P1-T7's tail
 * is. Blank lines are dropped rather than carried: a real transcript ends with a newline, and a
 * fixture whose last line is empty asserts a trailing record that is not there.
 */
/** Scrubs one record and refuses to hand back anything still keyed by data. */
function scrubChecked(record) {
  assertNoDataKeys(record, '$', undefined);
  return scrub(record, undefined);
}

function render(raw, name) {
  // A frame is not records and is not a document: it is a byte stream a terminal replays, so it
  // comes back exactly as long as it went in, with no trailing newline added. One appended here
  // would be one row of scroll the real `claude logs` never sent.
  if (name.endsWith('.txt')) return scrubFrame(raw);
  if (!name.endsWith('.jsonl')) {
    return `${JSON.stringify(scrubChecked(JSON.parse(raw)), null, 2)}\n`;
  }
  const records = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.stringify(scrubChecked(JSON.parse(line))));
  return `${records.join('\n')}\n`;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let files;
  try {
    files = listRawFiles(RAW_ROOT);
  } catch {
    console.log('fixtures/raw is empty — nothing to scrub');
    return 0;
  }

  const { scrubbable: raw, deferred, unhandled } = triage(files);
  for (const file of deferred) {
    console.log(`deferred: ${basename(file)} — ${DEFERRED.get(basename(file))}`);
  }
  if (unhandled.length > 0) {
    for (const file of unhandled) {
      console.error(`cannot scrub: ${basename(file)} — not JSON and not in DEFERRED`);
    }
    return 1;
  }

  let changed = 0;
  for (const file of raw) {
    const source = basename(dirname(file));
    const output = join(ROOT, 'fixtures', source, basename(file));
    const text = render(readFileSync(file, 'utf8'), basename(file));

    // No initialiser: both paths below assign, and eslint 10's `no-useless-assignment` is right
    // that writing one here only hides which of them ran.
    let existing;
    try {
      existing = readFileSync(output, 'utf8');
    } catch {
      existing = null;
    }
    if (existing === text) continue;
    changed += 1;
    if (checkOnly) {
      console.error(`would change: fixtures/${source}/${basename(file)}`);
      continue;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, text, 'utf8');
    console.log(`scrubbed fixtures/${source}/${basename(file)}`);
  }

  if (changed === 0) {
    const note = deferred.length > 0 ? `, ${deferred.length} deferred` : '';
    console.log(`${raw.length} raw capture(s), all fixtures up to date${note}`);
  }
  return checkOnly && changed > 0 ? 1 : 0;
}

// Importable for tests; only runs the scrub when invoked as a script.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

// Scrubs raw captures in fixtures/raw/** into committable fixtures under fixtures/<source>/.
// CODING-STANDARDS.md §10.3. Raw captures never enter the repo; these outputs do.
//
//   node scripts/capture-fixtures.mjs            scrub every raw capture
//   node scripts/capture-fixtures.mjs --check    fail if any output would change (CI)
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
const STRUCTURAL_SEGMENTS = new Set([
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
    if (index === 0) return 'C:';
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
const FREE_TEXT_KEYS = new Set(['detail', 'intent', 'result', 'session_name', 'session_title']);

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
    return scrubSessionName(node, keepShortIdDerivable(node, scrubbed));
  }
  if (typeof node !== 'string') return node;
  if (key !== undefined && AUTHORED_KEYS.has(key)) return node;
  if (key !== undefined && FREE_TEXT_KEYS.has(key)) return `text-${digest(node, 8)}`;
  if (key !== undefined && VOCABULARY_KEYS.has(key)) return value12(node);
  return scrubString(node);
}

// Vocabulary values are kept verbatim, but a surprisingly long one is still scrubbed — a field
// that is supposed to be an enum and arrives as a paragraph is not vocabulary.
function value12(text) {
  return text.length <= 40 ? text : scrubString(text);
}

// Raw captures this script knowingly cannot scrub, each with the task that will handle it.
//
// The list exists because the alternative is worse in both directions. Silently ignoring a file
// it cannot parse is what this script used to do: it reported "11 raw capture(s)" against twelve
// files on disk, `--check` passed, and a shape captured in P0 was absent from the repo for a day
// without anything saying so (P0-T9). Failing outright instead would redden CI over a file nobody
// has decided how to scrub yet. So a deferral is allowed but must be WRITTEN DOWN, and anything
// not on the list is an error — a new unscrubbable capture cannot arrive quietly.
const DEFERRED = new Map([
  ['logs-blocked.txt', 'P5a-T4 — `claude logs` is a 4723-line terminal frame, not JSON'],
]);

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
    if (name.endsWith('.json')) scrubbable.push(file);
    else if (DEFERRED.has(name)) deferred.push(file);
    else unhandled.push(file);
  }
  return { scrubbable, deferred, unhandled };
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
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const output = join(ROOT, 'fixtures', source, basename(file));
    const text = `${JSON.stringify(scrub(parsed, undefined), null, 2)}\n`;

    let existing = null;
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

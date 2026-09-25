// Line logs — `.log` captures. P7-T4, DECISIONS.md D60.
//
// `daemon.log` is the third shape the scrubber has met and it fits neither of the other two. It is
// not JSON, so there are no keys to classify; and it is not a terminal frame, so D42's rule —
// replace every letter in place and never read the words — would destroy the one thing its parser
// needs, which is the WORDS: `retire`, `idle-prompt`, `empty-idle`, `settled`, `killed`. A fixture
// of `bg xxxxxx 3f1a…: xxxxxxxxxxx` is a log with the vocabulary gone, and the vocabulary is what
// P7-T4 reads (RESEARCH.md B.3, F.2.15).
//
// **So the rule is a GRAMMAR, and it is an allowlist.** Every line must be `[<instant>]
// [<channel>] <message>` and every message must match one of the templates below, whole. A
// template's literal words are Claude Code's own and pass through; its SLOTS are either a shape
// that cannot carry identity by construction (`\d+`, a version, a lowercase vocabulary word) or
// one of two kinds this script rewrites — a short session id and a Windows path. **A line that
// matches no template fails the capture and names its line number**, the way `assertNoDataKeys`
// stops on an unclassified key: the day Claude Code logs a prompt, a folder or a session name, the
// capture stops instead of committing it.
//
// Short ids are rewritten by a digest of the id, so every line about one session still names the
// same (fake) session — a `bg retire` and the `bg settled` 1.1 s after it are ONE retirement, and
// a fixture that broke the pair would be the P0-T9 lie again. Instants shift by the same constant
// the JSON rule uses; pids, versions, counts and durations are kept, because they are not identity
// and because the supervisor PID is exactly the join `daemon/roster.json` and this log share
// (F.2.16).

const LINE =
  /^\[(?<instant>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[(?<channel>[a-z]+)\] (?<message>.*)$/u;

const VERSION = String.raw`\d+\.\d+\.\d+`;
const WORD = '[a-z][a-z_-]*';
const ID = '(?<id>[0-9a-f]{8})';

/**
 * Every message this build has seen, whole. Named groups are the slots that get rewritten; every
 * other variable part is a class that cannot hold anything but a number, a version or a word.
 */
export const LOG_TEMPLATES = [
  `─── daemon start ─── version=${VERSION} pid=\\d+ origin=${WORD}`,
  String.raw`auth: scheduling proactive refresh in \d+s`,
  'auth: proactive refresh (?:starting|succeeded)',
  String.raw`workers=\d+`,
  String.raw`idle \d+s with no clients — exiting`,
  String.raw`shutting down \(cause=${WORD}, uptime=\d+s, leases=\d+, live_workers=\d+\)`,
  String.raw`binary at (?<path>[A-Za-z]:\\[^ ]+) changed \(mtime changed\) — self-restarting for upgrade`,
  String.raw`another daemon is already running \(pid=\d+, version=${VERSION}, origin=${WORD}; an on-demand daemon never displaces a running one\)\. Stop it with ` +
    String.raw`\x60taskkill /PID \d+\x60, then retry\.`,
  // Claude Code prints the pipe with its id already replaced by `*` — the template requires the
  // star, so a build that started printing the real name would fail here rather than commit it.
  String.raw`bg: control socket bound at \\\\\.\\pipe\\cc-daemon-\*-control`,
  String.raw`bg spawned ${ID} \(${WORD}\)`,
  String.raw`bg retire ${ID}: ${WORD}, idle \d+m(?: \[low memory\])?`,
  String.raw`bg settled ${ID} \(${WORD}\)`,
  String.raw`bg adopt: adopted=\d+ respawned=\d+ dead=\d+(?: dead_epoch=\d+)?`,
  String.raw`bg: post-takeover prewarm burst — respawned \d+/\d+ stale workers(?:, \d+ refused)? in \d+s`,
].map((template) => new RegExp(`^${template}$`, 'du'));

/**
 * One message, with its slots rewritten.
 *
 * `indices` (the `d` flag) is what lets a slot be replaced where it IS rather than wherever its
 * text first occurs — a short id that happened to appear inside a path would otherwise be the one
 * rewritten.
 */
function scrubMessage(message, rules) {
  for (const template of LOG_TEMPLATES) {
    const match = template.exec(message);
    if (match === null) continue;
    const slots = Object.entries(match.indices?.groups ?? {})
      .filter(([, span]) => span !== undefined)
      .sort(([, left], [, right]) => right[0] - left[0]);
    let out = message;
    for (const [name, [start, end]] of slots) {
      const original = message.slice(start, end);
      const replaced = name === 'id' ? rules.id(original) : rules.path(original);
      out = out.slice(0, start) + replaced + out.slice(end);
    }
    return out;
  }
  return undefined;
}

/**
 * A whole log, scrubbed line by line.
 *
 * @param rules the three rewrites, passed in rather than imported so this module and
 * `capture-fixtures.mjs` do not import each other: `instant` and `path` are the JSON rules' own,
 * and `id` is a digest of the short id.
 * @throws on the first line that is not `[instant] [channel] message` or whose message matches no
 * template — see the header. Blank lines are kept as blank; a trailing newline is kept if present.
 */
export function scrubLog(raw, rules) {
  const lines = raw.split('\n');
  const scrubbed = lines.map((line, index) => {
    if (line === '') return line;
    const parts = LINE.exec(line);
    const message =
      parts?.groups === undefined ? undefined : scrubMessage(parts.groups.message, rules);
    if (parts?.groups === undefined || message === undefined) {
      throw new Error(
        `daemon log line ${String(index + 1)} matches no template in scripts/capture-log.mjs — ` +
          'read it, and add a template only if every variable part is a number, a version, a ' +
          'vocabulary word, a short id or a path',
      );
    }
    return `[${rules.instant(parts.groups.instant)}] [${parts.groups.channel}] ${message}`;
  });
  return scrubbed.join('\n');
}

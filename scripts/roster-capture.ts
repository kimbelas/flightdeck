// P0-T9 — captures `daemon/roster.json` as a fixture, which needs a live background worker.
//
//   node scripts/roster-capture.ts
//
// The roster's interesting half is `workers.<id>`, and it is empty unless a `--bg` session is
// running — an interactive session never appears in it. So this starts ONE throwaway background
// session, reads the roster while it is alive, and stops and removes it again. P0-T4 did the same
// thing for the same reason (fd-spike-*, removed on completion).
//
// It touches nothing it did not start. The session id comes back from the spawn and every verb
// afterwards is addressed to that id, never to a name, a listing position, or "the newest one" —
// SEC-PROC-5, and the reason P0-T4 could state that the owner's own sessions were never touched.
//
// The denied fields never reach disk: `projectRoster` runs between reading the file and writing
// the capture, so `rvAuth`, `ptyAuth` and `dispatch` are gone before anything is serialised.
// fixtures/raw/ being git-ignored is not the control — SEC-FS-2 says never read, not never commit.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { projectRoster, type RosterView } from '../contracts/daemon-roster.ts';

const run = promisify(execFile);

const BINARY =
  process.env['FD_CLAUDE_BIN'] ??
  join(
    homedir(),
    'AppData',
    'Roaming',
    'npm',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
const CONFIG_DIR = process.env['FD_CONFIG_DIR'] ?? join(homedir(), '.claude-isg');
const RAW_FILE = join(import.meta.dirname, '..', 'fixtures', 'raw', 'daemon', 'roster.json');
const SESSION_NAME = 'fd-roster';
/** Short and answerable in one turn; the point is a worker in the roster, not a conversation. */
const PROMPT = 'Reply with exactly: OK';
const VERB_TIMEOUT_MS = 60_000;
/** How long the daemon gets to put the new worker in the roster before this gives up. */
const WORKER_APPEAR_BUDGET_MS = 20_000;

/** Runs one `claude` verb with an argument array and a minimal env (SEC-PROC-1, §3 rule 5). */
async function claude(args: readonly string[]): Promise<string> {
  const { stdout } = await run(BINARY, [...args], {
    env: {
      CLAUDE_CONFIG_DIR: CONFIG_DIR,
      PATH: process.env['PATH'] ?? '',
      USERPROFILE: process.env['USERPROFILE'] ?? '',
      APPDATA: process.env['APPDATA'] ?? '',
      LOCALAPPDATA: process.env['LOCALAPPDATA'] ?? '',
      TEMP: process.env['TEMP'] ?? '',
    },
    timeout: VERB_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout;
}

/**
 * Starts the throwaway worker and returns the id `stop` and `rm` will be addressed to.
 *
 * The id comes from the ROSTER — the one worker key that was not there a moment ago — and never
 * from parsing the spawn's output. The first version of this script did parse stdout, fell back
 * to "the last whitespace-separated token" when its pattern missed, and duly ran `rm session`
 * against a session called `session`. `rm` removes a live session with no confirmation
 * (RESEARCH.md F.2.5), so an id that might be a stray English word is precisely what this must
 * never produce. A roster diff cannot name a session this script did not start (SEC-PROC-5).
 *
 * Fails closed: anything other than exactly one new worker throws with the ids involved, so a
 * human removes the right thing by hand rather than a script guessing.
 */
async function startWorker(): Promise<string> {
  const before = new Set(workerIds());
  await claude(['--bg', '-n', SESSION_NAME, PROMPT]);

  const deadline = Date.now() + WORKER_APPEAR_BUDGET_MS;
  let appeared: string[] = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    appeared = workerIds().filter((id) => !before.has(id));
    if (appeared.length === 1) return appeared[0] ?? '';
    if (appeared.length > 1) break;
  }
  throw new Error(
    `expected exactly one new roster worker, saw [${appeared.join(', ')}]. ` +
      `Nothing was stopped or removed; check \`claude agents\` and remove ${SESSION_NAME} by hand.`,
  );
}

/** Worker ids currently in the roster; an unreadable roster reads as none. */
function workerIds(): readonly string[] {
  try {
    return Object.keys(readRoster().workers);
  } catch {
    return [];
  }
}

function readRoster(): RosterView {
  const file = join(CONFIG_DIR, 'daemon', 'roster.json');
  // projectRoster is applied to the parse immediately. Nothing between this line and the write
  // ever holds rvAuth, ptyAuth or dispatch (SEC-FS-2, DECISIONS.md D24).
  return projectRoster(JSON.parse(readFileSync(file, 'utf8')));
}

function write(view: RosterView): void {
  mkdirSync(join(RAW_FILE, '..'), { recursive: true });
  const body = { claude_version: process.env['FD_CLAUDE_VERSION'] ?? 'unknown', ...view };
  writeFileSync(RAW_FILE, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

async function removeWorker(id: string): Promise<void> {
  // `stop` then `rm`, both addressed to the id this script started. `rm` removes a live session
  // with no confirmation (RESEARCH.md F.2.5), which is why the id is never guessed.
  for (const verb of ['stop', 'rm']) {
    try {
      await claude([verb, id]);
    } catch (error) {
      console.error(`  ${verb} ${id} failed: ${String(error).slice(0, 120)}`);
    }
  }
}

async function main(): Promise<number> {
  console.log(`starting one throwaway background session in ${CONFIG_DIR}`);
  const id = await startWorker();
  console.log(`  started ${id} — it will be stopped and removed before this exits`);
  try {
    const view = readRoster();
    const ids = Object.keys(view.workers);
    console.log(`  roster workers: ${ids.length === 0 ? '(none)' : ids.join(', ')}`);
    if (ids.length === 0) {
      console.error('  no worker in the roster — nothing worth capturing, not writing a fixture');
      return 1;
    }
    write(view);
    console.log(`  wrote ${RAW_FILE}`);
    console.log('  run `node scripts/capture-fixtures.mjs` to scrub it into fixtures/daemon/');
    return 0;
  } finally {
    await removeWorker(id);
    console.log(`  removed ${id}`);
  }
}

process.exitCode = await main();

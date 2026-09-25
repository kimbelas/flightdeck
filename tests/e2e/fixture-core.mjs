// A flightdeck-core that owns no PTY, reads no `~/.claude*` and spawns nothing — P2-T7.
//
// **Why a double rather than the real core, and rather than intercepting in the browser.** The
// smoke exists to prove the deck hydrates and works, on a runner with no Claude Code, no session
// and no ConPTY. Two other shapes were considered and rejected (DECISIONS.md D35):
//
//   - `page.route()` interception fakes at the browser boundary, which is on the far side of every
//     layer that has actually broken here — `proxy.ts`'s per-request nonce, the rewrite's bearer,
//     `/api/stream`'s `no-transform` and `identity` legs. Six of the §G bugs lived in exactly that
//     gap, and a smoke that steps over it would have caught none of them. `route.fulfill` also
//     cannot stream: an SSE body arrives complete and the connection then closes, so "the live
//     feed" would be a single batch and a reconnect loop.
//   - A fixture MODE inside core would put a test-only branch in the process that owns the PTYs
//     and writes the token, and would drag sqlite, node-pty and `claude.exe` onto the runner.
//
// So: everything above the wire is the real thing — real `next build` output, real proxy, real
// route handler, real EventSource, real WebSocket — and only what is on the far end of the wire is
// fixture. This file speaks core's HTTP surface and core's PTY protocol, and nothing else.
//
// **It runs IN the smoke's process, not as a child.** That is the whole reason there is no control
// channel: `publish()` is a method call, and what core RECEIVED — the launch body, the bearer on
// each request, which tickets were minted — is an array the checks can read.
//
// **The fixture is hand-written, and this file is what makes that safe.** `fixtures/` proper is
// generated from captures and must never be hand-edited (the `capture` skill); this is not that.
// A `DeckSnapshot` is Flightdeck's OWN wire format — there is no upstream tool to capture and
// nothing to scrub — and the rows have to be stable because the assertions name them. What a
// capture would have bought is the guarantee that the shape is real, and that is bought here
// instead: every fixture goes through the SAME parsers the deck uses, at boot, and the server
// refuses to start on one that no longer matches the contract.
import { createServer } from 'node:http';
import { win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CORE_PORT, LOOPBACK_ADDRESS } from '../../contracts/origins.ts';
import { PASTED_IMAGE_PATH } from '../../contracts/pasted-image.ts';
import { PastedImage } from '../../core/domain/pasted-image.ts';
import { KeybindingPlanner } from '../../core/application/keybinding-planner.ts';
import { ConnectPlanner } from '../../core/application/connect-planner.ts';
import { StatuslinePatcher } from '../../core/adapters/statusline/statusline-patcher.ts';
import { PresetCatalogue } from '../../core/domain/preset-catalogue.ts';
import { ConfigHistorian } from '../../core/application/config-historian.ts';
import { FakeStore } from '../fakes/fake-store.ts';
import {
  agentRoster,
  byProjectThenName,
  optionalAgent,
  parsePresetDraft,
  parsePresetRef,
  pinsAgent,
  pinsSessionName,
  presetId,
  PROFILE_FUNCTIONS,
} from '../../contracts/launch-preset.ts';
import { MAX_GROUP_LAUNCH, presetGroups } from '../../contracts/preset-group.ts';
import { parseProjectPathBody, projectKey, projectName } from '../../contracts/project.ts';
import { parseWorkflowMap } from '../../contracts/workflow-map.ts';
import { ASK_MAX_BUDGET_USD } from '../../contracts/ask-run.ts';
import { SUBSCRIPTION_IDS } from '../../contracts/session.ts';
import { parseQuotaSummary } from '../../contracts/quota-summary.ts';
import { parseSessionRef } from '../../contracts/session-ref.ts';
import { parseDeckSnapshot, parseSessionRow } from '../../contracts/session-row.ts';
import { parseSessionDetail } from '../../contracts/session-detail.ts';
import { condense, parseSessionPreview } from '../../contracts/session-preview.ts';
import { parseClientFrame, parsePtyTarget, sameTarget } from '../../contracts/pty-protocol.ts';

const FIXTURE = new URL('./fixtures/deck.json', import.meta.url);

/**
 * The directory the fixture pretends it wrote a pasted image to — P5a-T8.
 *
 * It contains a SPACE on purpose. `%LOCALAPPDATA%` carries the Windows account name, an account
 * name may have a space in it, and the deck quotes a path that does — so without one here that
 * branch would only ever run on the machines it breaks on.
 */
const PASTE_DIRECTORY = String.raw`C:\Users\Ada Lovelace\AppData\Local\flightdeck\pasted`;

/**
 * A `Logger` that says nothing — P3-T7.
 *
 * The historian logs only when the store fails, which an in-memory one does not, and a double that
 * printed into the smoke's own output would make a passing run harder to read than a failing one.
 */
const SILENT_LOGGER = {
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  },
};

/** How long ago the fixture's FIRST config snapshot was taken — P3-T7. See `driftAgeMs`. */
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Every key whose number is an instant. See the fixture's header — they are shifted, not pinned. */
const TIME_KEYS = new Set([
  'at',
  'startedAt',
  'takenAt',
  'resetsAt',
  'updatedAt',
  'awaySummaryAt',
  'lastToolAt',
  'spendSince',
]);

/**
 * The three files Connect rewrites — P4-T6. Fixture paths, never `~/.claude*`.
 *
 * The statusline source carries the two anchors `StatuslinePatcher` splices between, and the isg
 * settings.json is **CRLF while the 365 one is LF**, which is the difference on the real machine
 * and the one G.13 turned into a whole-file rewrite. A smoke that used the same line endings for
 * both would render a diff that could never show that bug coming back.
 */
const CONNECT_SETTINGS = {
  365: String.raw`C:\cfg\.claude-365\settings.json`,
  isg: String.raw`C:\cfg\.claude-isg\settings.json`,
};
const CONNECT_STATUSLINE = String.raw`C:\cfg\.claude\hooks\statusline.py`;
const CONNECT_SETTINGS_365_SOURCE = '{\n  "model": "opus"\n}\n';
const CONNECT_SETTINGS_ISG_SOURCE = '{\r\n  "model": "sonnet"\r\n}\r\n';
const STATUSLINE_SOURCE = [
  '#!/usr/bin/env python3',
  'import json',
  'import sys',
  '',
  '',
  'def cache_flush():',
  '    pass',
  '',
  '',
  'def main():',
  '    data = json.load(sys.stdin)',
  '    sys.stdout.write("ctx 21%")',
  '    cache_flush()',
  '',
  '',
  'if __name__ == "__main__":',
  '    main()',
  '',
].join('\n');

/** The REAL patcher, reading the real block out of the repo — the diff has to be the diff. */
const STATUSLINE_PATCHER = StatuslinePatcher.fromRepo();

/** What a pane sees before it types anything. Long enough that "xterm painted" is a real check. */
const BANNER = 'fixture shell — echo only, no PTY was spawned\r\n$ ';

/** Core's own deadline for the first frame (SEC-WS-1). Mirrored so the double refuses as core does. */
const AUTH_DEADLINE_MS = 2000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
  connection: 'keep-alive',
};

/** Core's own shape check, repeated so the fixture refuses exactly what core refuses. */
const FULL_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** What `stop` takes, and what names a job directory — eight lowercase hex (F.7.1, F.2.8b). */
const SHORT_SESSION_ID = /^[0-9a-f]{8}$/u;

/**
 * The id a forked session comes back with — P6-T6.
 *
 * Exported so the check that pushes the fork onto the snapshot uses the SAME id core answered
 * with. A made-up one would let a deck that drew the row from the reply pass the check that says
 * it must not: the row would be there either way.
 *
 * @param nth 1 for the first handoff of the run. Shaped like a uuid, because the deck's contracts
 * refuse anything else and a double that sent a looser id would be testing a looser deck.
 */
export function forkIdFor(nth) {
  return `f0000000-0000-4000-8000-${String(nth).padStart(12, '0')}`;
}

export class FixtureCore {
  /**
   * @param tokenFile where to write the per-boot token. The smoke points both this and the deck's
   * `FD_TOKEN_FILE` at the same path in a temp directory, so nothing under `~/.claude*` or
   * `%LOCALAPPDATA%\flightdeck` is touched — a smoke run must never disturb a live core's token.
   */
  constructor(tokenFile) {
    this.tokenFile = tokenFile;
    this.token = randomUUID();
    this.fixture = undefined;
    this.streams = new Set();
    this.tickets = new Map();
    /** Every target a ticket was minted for. One per pane, and the checks count them. */
    this.minted = [];
    /**
     * How long `POST /pty-ticket` sits on its hands before answering — 0 unless a check asks.
     *
     * It exists for exactly one assertion: the keystrokes a person gets in while a pane is still
     * minting and handshaking (RESEARCH.md G.5). On a loopback fixture that window is sub-millisecond,
     * so a check that simply typed quickly would pass whether or not the input is buffered — which
     * is what the first draft of it did, measured. Widening the window here is what makes the race
     * a thing a test can stand in the middle of.
     */
    this.mintDelayMs = 0;
    /**
     * The config history, over the same `ConfigHistorian` core runs — P3-T7.
     *
     * A `FakeStore` behind it rather than a stub: the historian's whole behaviour is "compare with
     * the two newest rows and write only when they differ", so a store that forgot would make
     * every read report a change and a store that never wrote would make none report one.
     */
    this.historian = new ConfigHistorian({
      store: new FakeStore(),
      clock: { now: () => new Date(Date.now() - this.driftAgeMs) },
      logger: SILENT_LOGGER,
    });
    /** 0 until a check calls `driftConfig()`, after which the fixture's `.claude` has moved. */
    this.driftedAt = 0;
    /**
     * How far in the past the historian stamps a snapshot.
     *
     * The smoke makes both snapshots within a second of each other, so `changed 0s ago` is what
     * the row would say — true, and useless as a check that the AGE is drawn at all. Backdating
     * the first one makes the gap a real number the check can read.
     */
    this.driftAgeMs = THREE_DAYS_MS;
    /** Every pop-out core was asked for — P6-T2. What the deck sent, not what it drew. */
    this.popouts = [];
    /** Every handoff core was asked for — P6-T6. The folder and the name, as the row sent them. */
    this.handoffs = [];
    /** Every adoption core was asked for — P6-T7. The whole body, so a check can see what is NOT in it. */
    this.adoptions = [];
    /** A code to refuse the NEXT adoption with, or `undefined` to accept it. `refuseHandoff`'s twin. */
    this.refuseAdopt = undefined;
    /**
     * A code to refuse the NEXT handoff with, or `undefined` to accept it.
     *
     * Set by a check rather than derived, because the deck only ever offers worktrees core knows
     * about — so the refusal path is not reachable by pressing the control, and it is the half
     * worth seeing through a browser: the sentence has to land on the row that pressed and the
     * form has to stay up with the two answers still in it. Cleared as it is used, so a refusal
     * armed for one press cannot silently refuse the next.
     */
    this.refuseHandoff = undefined;
    /** `sessionKey` strings, exactly as `MuteBook` holds them — P6-T3. */
    this.muted = new Set();
    /** Every group press core was asked for — P6-T4. What the palette sent, not what it drew. */
    this.groupPresses = [];
    /** Held while a press is 'in flight', so a smoke check can reach the 409 — P6-T4. */
    this.groupBusy = false;
    /** Every request core answered, so a check can ask what the deck actually sent. */
    this.requests = [];
    /** The bodies of every `POST /sessions`. The launch form's real destination. */
    this.launches = [];
    /** The bodies of every `POST /sessions/resume` — P4-T2a. */
    this.resumes = [];
    /** The bodies of every `POST /sessions/stop` — P4-T2b. */
    this.stops = [];
    /**
     * The bodies of every `POST /sessions/rm` — P4-T2.
     *
     * An array the checks read, and the reason the smoke can assert that NOTHING reached the
     * destructive route until the second button was pressed. A set would lose the order; a
     * boolean would lose the count.
     */
    this.removals = [];
    /** The bodies of every `POST /run` — the Ask panel's destination (P4-T4). */
    this.asks = [];
    /** The bodies of every `POST /update` and `POST /sessions/respawn` — P4-T5. */
    this.updates = [];
    this.respawns = [];
    /** How many times `GET /doctor` was asked. The panel must not poll it (F.10.1: ~2 s). */
    this.doctorReads = 0;
    /** The open run's id, or `undefined`. Core allows one at a time and so does this. */
    this.askRunId = undefined;
    this.askSubscription = '365';
    /**
     * Every session a preview was asked about, in order — P5a-T4.
     *
     * An ARRAY rather than a set, and that is the assertion it exists for: pressing the button
     * again must ask again, because a preview is a photograph and the button is the only refresh
     * there is (RESEARCH.md F.2.5 — never poll it).
     */
    this.previewed = [];
    /** Every image accepted by `POST /pasted-images` — kind and decoded size (P5a-T8). */
    this.pasted = [];
    /**
     * The two keybindings.json files, in memory — P5a-T7.
     *
     * `undefined` means "not there", which is the state that matters: the helper's first write
     * CREATES both, and creating is the branch that must not ask for a backup. Nothing here
     * touches a disk, so a smoke run cannot rewrite the owner's real config.
     */
    this.keybindings = new Map([
      [String.raw`C:\cfg\.claude-365\keybindings.json`, undefined],
      [String.raw`C:\cfg\.claude-isg\keybindings.json`, undefined],
    ]);
    /**
     * The three files Connect rewrites, in memory — P4-T6.
     *
     * A Map for `keybindings`' reason: a smoke run must never go near `~/.claude*`, and Connect is
     * the one feature in this repo whose real target IS the owner's live config on both profiles.
     * The CONTENTS are real enough for the real planner — two settings.json with no hooks block,
     * and a statusline.py carrying the two anchors `StatuslinePatcher` splices between — because
     * what the deck renders is a diff, and a diff of a stub would prove nothing about the diff of
     * a file.
     */
    this.connectFiles = new Map([
      [CONNECT_SETTINGS['365'], CONNECT_SETTINGS_365_SOURCE],
      [CONNECT_SETTINGS.isg, CONNECT_SETTINGS_ISG_SOURCE],
      [CONNECT_STATUSLINE, STATUSLINE_SOURCE],
    ]);
    /** Whether the ingest key would reach a new session. `SessionEnvironment`, as a boolean. */
    this.ingestKeyPublished = false;
    /** Every direction `POST /connect` was asked for, in order. */
    this.connectWrites = [];
    /** Every `input` frame the PTY socket received, so a check can ask what the pane SENT. */
    this.typed = [];
    /** Which target each open PTY socket is attached to, so `stop` can end the right one. */
    this.attached = new Map();
    /**
     * The project registry, as a real core would hold it — P3-T1.
     *
     * A map keyed the way the sqlite table is, so re-importing is a replace rather than a second
     * row, and it starts EMPTY because that is what ships (DECISIONS.md D26). The refusal rules
     * are core's, not this file's: only the shapes the deck can actually produce from a text box
     * are answered here, and the four SEC-FS-1 checks are unit-tested where they live.
     */
    this.projects = new Map();
    /**
     * The SAVED presets, keyed the way the sqlite table is — P4-T1.
     *
     * The built-ins are not in here and must not be: core computes them from the project and the
     * four profile functions on every request, so a double that stored them would be answering a
     * question core does not ask. `PresetCatalogue` is imported rather than copied for exactly
     * that reason — if the built-in set changes, this changes with it.
     */
    this.presets = new Map();
    /** Every body `POST /projects/presets` was sent. The save button's real destination. */
    this.presetSaves = [];
    this.catalogue = new PresetCatalogue();
    this.server = createServer((request, response) => {
      void this.route(request, response);
    });
    this.sockets = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (request, socket, head) => {
      this.upgrade(request, socket, head);
    });
  }

  /** How many decks are listening. The checks wait on this rather than on a sleep. */
  get subscriberCount() {
    return this.streams.size;
  }

  async start() {
    this.fixture = validated(shiftTimes(JSON.parse(await readFile(FIXTURE, 'utf8'))));
    writeFileSync(this.tokenFile, this.token, 'utf8');
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(CORE_PORT, LOOPBACK_ADDRESS, resolve);
    });
  }

  async stop() {
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    this.sockets.close();
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** One frame to every open stream — the deltas the deck is supposed to apply without a fetch. */
  publish(name, data) {
    for (const stream of this.streams) {
      stream.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  async route(request, response) {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_ADDRESS}`);
    const bearer = request.headers.authorization;
    this.requests.push({ method: request.method, path: url.pathname, bearer });
    // Every route, `/health` included — core has no unauthenticated route and neither has this.
    if (bearer !== `Bearer ${this.token}`) {
      send(response, 401, { error: 'refused' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/stream') {
      this.openStream(request, response);
      return;
    }
    send(response, ...(await this.answer(request, url)));
  }

  /** @returns `[status, body]` — the double never touches the socket outside `openStream`. */
  async answer(request, url) {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/health') return [200, { ok: true }];
    if (request.method === 'GET' && path === '/sessions') return [200, this.fixture.snapshot];
    if (request.method === 'GET' && path === '/session') return [200, this.detailFor(url)];
    if (request.method === 'GET' && path === '/preview') return [200, this.previewFor(url)];
    if (request.method === 'POST' && path === '/sessions') return this.launch(await body(request));
    if (request.method === 'POST' && path === '/sessions/resume') {
      return this.resume(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/stop') {
      return this.stopSession(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/popout') {
      return this.popOut(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/rm') {
      return this.removeSession(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/handoff') {
      return this.handOff(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/adopt') {
      return this.adopt(await body(request));
    }
    if (request.method === 'POST' && path === '/run') return this.startAsk(await body(request));
    if (request.method === 'GET' && path === '/doctor') return this.doctor(url);
    if (request.method === 'POST' && path === '/update') return this.update(await body(request));
    if (request.method === 'POST' && path === '/sessions/respawn') {
      return this.respawn(await body(request));
    }
    if (request.method === 'POST' && path === '/pty-ticket') {
      const raw = await body(request);
      if (this.mintDelayMs > 0) await new Promise((done) => setTimeout(done, this.mintDelayMs));
      return this.mint(raw);
    }
    if (request.method === 'POST' && path === PASTED_IMAGE_PATH) {
      return this.pasteImage(await body(request));
    }
    if (request.method === 'POST' && path === '/sessions/group') {
      return this.launchGroup(await body(request));
    }
    if (request.method === 'GET' && path === '/toasts/mutes') {
      return [200, { muted: [...this.muted].sort() }];
    }
    if (request.method === 'POST' && path === '/toasts/mutes') {
      return this.setMuted(await body(request));
    }
    if (request.method === 'GET' && path === '/keybindings') {
      return this.keybindingPlan(url.searchParams.get('direction') ?? 'apply');
    }
    if (request.method === 'GET' && path === '/connect') {
      return this.connectPlan(url.searchParams.get('direction') ?? 'connect');
    }
    if (request.method === 'POST' && path === '/connect') {
      return this.connectWrite(await body(request));
    }
    if (request.method === 'POST' && path === '/keybindings') {
      return this.keybindingWrite(await body(request));
    }
    if (request.method === 'GET' && path === '/projects') {
      return [200, { projects: [...this.projects.values()] }];
    }
    if (request.method === 'POST' && path === '/projects') return this.import(await body(request));
    if (request.method === 'POST' && path === '/projects/forget') {
      return this.forget(await body(request));
    }
    if (request.method === 'GET' && path === '/projects/status') {
      return [200, { statuses: [...this.projects.values()].map((held) => reading(held)) }];
    }
    if (request.method === 'GET' && path === '/projects/map') {
      // P3-T7. The REAL historian over an in-memory store, not a hand-made drift: what the
      // smoke is checking is that a change made on disk turns into a line on the row, and a
      // double that invented the drift would have proved only that the deck can draw one.
      const maps = [...this.projects.values()].map((held) => workflowMap(held, this.driftedAt));
      return [200, { maps, drifts: this.historian.observeAll(maps) }];
    }
    if (request.method === 'GET' && path === '/projects/observed') {
      return this.observed(url.searchParams.get('path'));
    }
    if (request.method === 'GET' && path === '/projects/presets') {
      return [200, { presets: this.presetList() }];
    }
    if (request.method === 'POST' && path === '/projects/presets') {
      return this.savePreset(await body(request));
    }
    if (request.method === 'POST' && path === '/projects/presets/forget') {
      return this.forgetPreset(await body(request));
    }
    return [404, { error: 'not found' }];
  }

  /**
   * `POST /projects` — P3-T1.
   *
   * It screens the way core screens, through the SAME parser (`parseProjectPathBody`), because the
   * deck is the thing being tested: if the panel and that parser ever stop agreeing about the
   * field name, the import has to fail in the smoke rather than be papered over by a double that
   * accepts anything. `C:\nope` is refused as `missing` so the panel's refusal path is reachable
   * without a real folder on the runner.
   */
  import(raw) {
    const path = parseProjectPathBody(raw);
    if (path === undefined) return [400, { error: 'empty' }];
    if (path.trim().toLowerCase().startsWith('c:\\nope')) return [400, { error: 'missing' }];
    const project = { path, name: projectName(path), importedAt: Date.now() };
    this.projects.set(projectKey(path), project);
    return [201, { project }];
  }

  /**
   * Edits the fixture's `.claude` — P3-T7.
   *
   * One hook added and one deny rule added, which is what one commit to a `settings.json` looks
   * like from out here. The next `GET /projects/map` walks the new config, the historian sees a
   * digest it has not seen, and a drift comes back with it.
   */
  driftConfig() {
    this.driftedAt = Date.now();
    // The NEW snapshot is stamped now, so the change is `0s ago` and the config it replaced
    // had stood three days — which is the pair of numbers the row is for.
    this.driftAgeMs = 0;
  }

  /**
   * `GET /projects/observed?path=` — P3-T5, and the registry lookup is the point.
   *
   * `ObservedRoute` answers 404 for a folder nobody imported rather than reading it, which is
   * SEC-FS-1 at the route rather than at the filesystem. The double repeats that rule so the
   * deck's own half — drop the key, put the button back — is reachable from the smoke.
   */
  observed(asked) {
    if (asked === null || asked === '') return [400, { error: 'bad request' }];
    const project = this.projects.get(projectKey(asked));
    if (project === undefined) return [404, { error: 'not imported' }];
    return [200, observedBehaviour(project)];
  }

  forget(raw) {
    const path = parseProjectPathBody(raw);
    if (path === undefined) return [400, { error: 'empty' }];
    const key = projectKey(path);
    // The store's cascade, repeated: a preset names a folder to start a session in, and core
    // deletes the row when the folder is withdrawn (core/ports/store.ts).
    for (const [slot, preset] of this.presets) {
      if (preset.projectKey === key) this.presets.delete(slot);
    }
    return [200, { forgotten: this.projects.delete(key) }];
  }

  /**
   * The merged list — `PresetBook.list`'s rule, repeated on the far side of the wire (P4-T1).
   *
   * Built-ins from the real `PresetCatalogue`, then the saved ones SHADOWING them by
   * `(projectKey, id)`, then one stable order. Repeated rather than imported whole because
   * `PresetBook` needs a registry, a store and an audit log, and this file owns none of those —
   * but the two pieces that decide what the deck SEES, the catalogue and the sort, are core's own.
   */
  presetList() {
    const merged = new Map();
    for (const project of this.projects.values()) {
      for (const preset of this.catalogue.builtInsFor(project)) {
        merged.set(`${preset.projectKey}|${preset.id}`, preset);
      }
    }
    for (const [slot, preset] of this.presets) {
      if (this.projects.has(preset.projectKey)) merged.set(slot, preset);
    }
    return [...merged.values()].sort(byProjectThenName);
  }

  /**
   * `POST /projects/presets` — screened through core's OWN parser, for `import`'s reason.
   *
   * If the panel and `parsePresetDraft` ever stop agreeing about a field name, the save has to
   * fail in the smoke rather than be papered over by a double that accepts anything. The two
   * refusals reachable from the page are the ones answered here: a name with nothing in it, and a
   * folder outside the project it is filed under.
   */
  savePreset(raw) {
    this.presetSaves.push(raw);
    const draft = parsePresetDraft(raw);
    if (draft === undefined) return [400, { error: 'empty' }];
    const id = presetId(draft.name);
    if (id === '') return [400, { error: 'bad_name' }];
    const key = projectKey(draft.projectPath);
    const project = this.projects.get(key);
    if (project === undefined) return [400, { error: 'unknown_project' }];
    const cwd = draft.cwd === '' ? project.path : draft.cwd;
    if (!projectKey(cwd).startsWith(key)) return [400, { error: 'bad_cwd' }];
    // P9-T1, in core's order: the pinned function first, then the project's own roster.
    if (draft.agent !== undefined && pinsAgent(draft.profileFn)) {
      return [400, { error: 'pins_agent' }];
    }
    if (draft.agent !== undefined && !this.rosterOf(project).includes(draft.agent)) {
      return [400, { error: 'unknown_agent' }];
    }
    const preset = {
      projectKey: key,
      id,
      name: draft.name,
      profileFn: draft.profileFn,
      cwd,
      sessionName: draft.sessionName,
      promptSource: draft.promptSource,
      prompt: draft.prompt,
      group: draft.group,
      agent: draft.agent,
      builtIn: false,
    };
    this.presets.set(`${key}|${id}`, preset);
    return [201, { preset }];
  }

  /** The agent roster of one imported folder, from the same map `GET /projects/map` draws. */
  rosterOf(project) {
    return agentRoster(workflowMap(project).assets);
  }

  /**
   * The launch-time roster check (P9-T1): the agent must be on the roster of the imported folder
   * the session would start in. `undefined` when it is, or the refusal code core would answer.
   */
  refuseAgent(request, agent) {
    if (pinsAgent(request.profileFn)) return 'pins_agent';
    const cwdKey = typeof request.cwd === 'string' ? projectKey(request.cwd) : '';
    const project = [...this.projects.values()].find((held) =>
      cwdKey.startsWith(projectKey(held.path)),
    );
    if (project === undefined || !this.rosterOf(project).includes(agent)) return 'unknown_agent';
    return undefined;
  }

  forgetPreset(raw) {
    const ref = parsePresetRef(raw);
    if (ref === undefined) return [400, { error: 'empty' }];
    const slot = `${projectKey(ref.projectPath)}|${ref.id}`;
    return [200, { forgotten: this.presets.delete(slot) }];
  }

  /**
   * One session's detail, screened the way core screens it (SEC-ING-1).
   *
   * A reference that does not parse is a 400 here too, because the deck is the thing being tested:
   * if `sessionRefQuery` and `parseSessionRef` ever stop agreeing, the expansion must fail in the
   * smoke rather than be papered over by a double that accepts anything.
   */
  detailFor(url) {
    const ref = parseSessionRef(Object.fromEntries(url.searchParams));
    if (ref === undefined) return { error: 'bad request' };
    // A session with no fixture detail answers the bare shape, which is an ordinary state: an
    // interactive session has no job directory and a fresh background one has written nothing.
    return this.fixture.details[ref.sessionId] ?? { sessionId: ref.sessionId, at: Date.now() };
  }

  /**
   * One session's preview — P5a-T4, screened exactly as the detail is.
   *
   * A session with no fixture preview answers `none` with no lines, which is the ordinary state
   * for a session nothing has read yet, and is what the deck draws "nothing to show" from.
   */
  previewFor(url) {
    const ref = parseSessionRef(Object.fromEntries(url.searchParams));
    if (ref === undefined) return { error: 'bad request' };
    this.previewed.push(ref.sessionId);
    const held = this.fixture.previews[ref.sessionId];
    if (held === undefined) {
      return {
        sessionId: ref.sessionId,
        at: Date.now(),
        source: 'none',
        lines: [],
        reason: 'daemon_down',
      };
    }
    // Condensed on the way out, through the SAME function core uses (`PreviewReader.preview`).
    // The fixture's lines carry the trailing padding and the blank band a real 200x50 frame
    // arrives with, so this is where they are removed — a double that shipped them raw would put
    // a shape on the wire that core never sends, and the deck is what is under test.
    return { ...held, lines: condense(held.lines) };
  }

  /**
   * `POST /sessions` — screened the way core screens it, which changed in P4-T2.
   *
   * A launch names a PROFILE FUNCTION rather than a subscription (D44), and a name is required
   * unless the function pins its own. Both rules are repeated here rather than waved through,
   * because the deck is the thing under test: a form that stopped sending one of them has to fail
   * in the smoke rather than be papered over by a double that accepts anything.
   */
  launch(raw) {
    const request = parseJson(raw);
    if (!PROFILE_FUNCTIONS.some((known) => known === request?.profileFn)) {
      return [400, { error: 'bad request' }];
    }
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      return [400, { error: 'bad_request' }];
    }
    const named = typeof request.name === 'string' && request.name.trim() !== '';
    if (!named && !pinsSessionName(request.profileFn)) return [400, { error: 'bad_request' }];
    const agent = optionalAgent(request.agent);
    if (agent === false) return [400, { error: 'bad request' }];
    const refusal = agent === undefined ? undefined : this.refuseAgent(request, agent);
    if (refusal !== undefined) return [400, { error: refusal }];
    this.launches.push(request);
    return [201, { sessionId: randomUUID() }];
  }

  /**
   * `GET /doctor` — the installation's health, ALREADY NARROWED (P4-T5).
   *
   * The fixture answers the shape core answers, which is the narrowed one: no `Path`, because
   * core drops it before it leaves (SEC-DATA-2, F.10.1). A fixture that sent the raw doctor output
   * would let a deck that rendered a path pass the smoke.
   */
  doctor(url) {
    const subscription = url.searchParams.get('subscription');
    if (!SUBSCRIPTION_IDS.includes(subscription)) return [400, { error: 'bad_subscription' }];
    this.doctorReads += 1;
    return [
      200,
      {
        subscription,
        healthy: true,
        autoUpdates: true,
        fields: [
          { key: 'Running', value: 'npm-global (2.1.278)' },
          { key: 'Platform', value: 'win32-x64' },
          { key: 'Auto-updates', value: 'enabled' },
          { key: 'Last update attempt', value: 'success -> 2.1.278 (2026-09-19)' },
        ],
      },
    ];
  }

  /** `POST /update` — the ordinary answer, because auto-updates are on (F.10.1). */
  update(raw) {
    const request = parseJson(raw);
    if (!SUBSCRIPTION_IDS.includes(request?.subscription)) {
      return [400, { error: 'bad_subscription' }];
    }
    this.updates.push(request);
    return [200, { subscription: request.subscription, changed: false, version: '2.1.278' }];
  }

  /**
   * `POST /sessions/respawn` — and `--all` does NOT restart everything (F.10.4).
   *
   * Measured, it skipped a session that had finished. The fixture answers one id for a two-session
   * machine on purpose, so a deck that printed "all sessions restarted" would be printing
   * something this double never said.
   */
  respawn(raw) {
    const request = parseJson(raw);
    if (!SUBSCRIPTION_IDS.includes(request?.subscription)) {
      return [400, { error: 'bad_session' }];
    }
    this.respawns.push(request);
    const respawned = request.all === true ? ['d1b2f43c'] : [request.shortId];
    return [200, { subscription: request.subscription, respawned }];
  }

  /**
   * `POST /run` — Ask, screened exactly as core screens it (P4-T4, D47, D48).
   *
   * **It answers 202 and a run id, and sends nothing back down this request.** The records arrive
   * as `ask` frames on the stream, which is the whole of D48 — so a fixture that replied with the
   * answer would let a broken deck pass by reading a body core never writes.
   *
   * The refusals are core's, in core's order: an unknown permission mode does NOT refuse (the
   * contract takes the default), a budget over the ceiling does, and a second run while one is
   * open answers 409.
   */
  startAsk(raw) {
    const request = parseJson(raw);
    if (request === undefined) return [400, { error: 'empty' }];
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (prompt === '') return [400, { error: 'empty' }];
    if (!SUBSCRIPTION_IDS.includes(request.subscription)) return [400, { error: 'empty' }];
    const budget = request.budgetUsd;
    if (typeof budget !== 'number' || budget <= 0 || budget > ASK_MAX_BUDGET_USD) {
      return [400, { error: 'bad_budget' }];
    }
    if (this.askRunId !== undefined) return [409, { error: 'busy' }];
    this.asks.push(request);
    this.askRunId = `ask-${String(this.asks.length)}`;
    this.askSubscription = request.subscription;
    return [202, { runId: this.askRunId }];
  }

  /** Publishes one Ask record for the open run, as core's runner would. */
  publishAsk(record) {
    if (this.askRunId === undefined) return;
    this.publish('ask', {
      runId: this.askRunId,
      subscription: this.askSubscription,
      record,
    });
    if (record.kind === 'done') this.askRunId = undefined;
  }
  /**
   * `POST /sessions/rm` — the destructive verb, screened exactly as `stop` is.
   *
   * `rm` takes the SHORT id and refuses the full uuid (F.8.4), the same way round as `stop`, so
   * the fixture refuses the same shapes core refuses. The row is dropped from the fixture snapshot
   * so a check can watch it disappear.
   */
  removeSession(raw) {
    const ref = parseJson(raw);
    if (!SHORT_SESSION_ID.test(ref?.shortId ?? '')) return [400, { error: 'bad_session' }];
    if (!FULL_SESSION_ID.test(ref?.sessionId ?? '')) return [400, { error: 'bad_session' }];
    this.removals.push(ref);
    return [200, { sessionId: ref.sessionId }];
  }

  /**
   * The worktrees the fixture reports for one imported folder — P6-T6.
   *
   * Built through the SAME function `GET /projects/map` answers with, so a check that asserts the
   * handoff's targets is asserting against what the deck was actually told rather than against a
   * number written twice. An unimported folder has none, which is the deck's own answer for one.
   */
  worktreesOf(projectPath) {
    const project = this.projects.get(projectKey(projectPath));
    return project === undefined ? [] : workflowMap(project).worktrees;
  }

  /**
   * `POST /sessions/adopt` — bringing an ended interactive session back (P6-T7).
   *
   * **No session is adopted here and none could be.** A real adoption spawns
   * `claude --bg --resume <uuid>` in the folder core remembers; which folder that is, and that it
   * is core's own reading rather than the browser's, is settled in `session-adopter.test.ts`.
   *
   * What lives on this side of the wire is what the row SENT — and the interesting half is what it
   * did NOT send. The body is a ref and no path: a browser that could name the directory a process
   * starts in is what SEC-FS-1 exists to prevent, and this double records the whole body so a
   * check can assert the absence.
   *
   * 200 and the id that went in, because an adoption keeps the id — the one thing that separates
   * it from the copy a stray flag would make (G.55).
   */
  adopt(raw) {
    const fields = parseJson(raw) ?? {};
    const { sessionId, subscription } = fields;
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    if (!known || !full) return [400, { error: 'bad_session' }];
    this.adoptions.push(fields);
    const refusal = this.refuseAdopt;
    this.refuseAdopt = undefined;
    if (refusal !== undefined) return [refusal === 'no_claude' ? 503 : 400, { error: refusal }];
    return [200, { sessionId }];
  }

  /**
   * `POST /sessions/handoff` — forking a session into a worktree (P6-T6).
   *
   * **No session is forked here and none could be.** A real handoff spawns
   * `claude --bg --resume <uuid> --fork-session -n <name>` in the target tree; what decides the
   * argv and what comes back is settled in `session-handoff.test.ts`. What lives on this side of
   * the wire is what the row SENT and what the deck does with the answer — and the answer is the
   * interesting half, because a handoff is the one verb that adds a session.
   *
   * **The fork is not published.** That is the assertion this double exists for: a real core says
   * 201 and the new row arrives on the next sweep, so a deck that drew the fork from this reply
   * would be showing a row core has not said exists. The check pushes the snapshot itself.
   *
   * Screened the way `HandoffRoute` screens: both ids, and a folder and a name that are there and
   * are not longer than core's own caps.
   */
  handOff(raw) {
    const { sessionId, shortId, subscription, cwd, name } = parseJson(raw) ?? {};
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    const short = typeof shortId === 'string' && SHORT_SESSION_ID.test(shortId);
    if (!known || !full || !short) return [400, { error: 'bad_session' }];
    if (typeof cwd !== 'string' || cwd.trim() === '' || cwd.length > 400) {
      return [400, { error: 'bad_cwd' }];
    }
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80) {
      return [400, { error: 'bad_name' }];
    }
    this.handoffs.push({ subscription, sessionId, shortId, cwd, name });
    const refusal = this.refuseHandoff;
    this.refuseHandoff = undefined;
    if (refusal !== undefined) return [refusal === 'no_claude' ? 503 : 400, { error: refusal }];
    // 201, because a handoff CREATES a session — the one thing that separates it from a resume.
    return [201, { sessionId: forkIdFor(this.handoffs.length) }];
  }

  /**
   * `POST /pasted-images` — P5a-T8.
   *
   * Screened through the SAME domain object core screens with, for the reason `import` above gives:
   * the deck is what is under test, and a double that accepted anything would let the page and the
   * guard drift apart without a check going red. Nothing is written — the fixture owns no disk —
   * so the path it answers with is made up, which is exactly what the pane then types.
   */
  pasteImage(raw) {
    const fields = parseJson(raw);
    const data = fields?.data;
    if (typeof data !== 'string' || data.length === 0) return [400, { error: 'bad request' }];

    const image = PastedImage.from(fields?.kind, new Uint8Array(Buffer.from(data, 'base64')));
    if (!image.ok) {
      return [image.error === 'too_large' ? 413 : 400, { error: image.error }];
    }
    this.pasted.push({ kind: image.value.kind, bytes: image.value.bytes.length });
    const name = `paste-20260920-143355-123-000${this.pasted.length}${image.value.extension}`;
    return [201, { path: win32.join(PASTE_DIRECTORY, name) }];
  }

  /**
   * `GET /keybindings` — P5a-T7, planned with core's OWN planner against in-memory files.
   *
   * The same argument as `import` and `pasteImage`: the deck is what is under test, so the plan it
   * renders has to be the plan core would produce. What is fixture is only WHERE the files are —
   * `this.keybindings` is a Map, so a smoke run never goes near `~/.claude*`, which is the one
   * thing a test on this machine must not do.
   */
  keybindingPlan(direction) {
    if (direction !== 'apply' && direction !== 'restore') return [400, { error: 'bad request' }];
    const planner = new KeybindingPlanner(this.keybindingSources());
    return [200, { direction, plan: direction === 'apply' ? planner.apply() : planner.restore() }];
  }

  keybindingWrite(raw) {
    const direction = parseJson(raw)?.direction;
    if (direction !== 'apply' && direction !== 'restore') return [400, { error: 'bad request' }];

    const planner = new KeybindingPlanner(this.keybindingSources());
    const plan = direction === 'apply' ? planner.apply() : planner.restore();
    if (!plan.ok) return [409, { error: 'refused', refusals: plan.refusals }];

    const backups = [];
    for (const change of plan.changes) {
      if (change.before !== '') backups.push(`${change.path}.bak-fixture`);
      this.keybindings.set(change.path, change.after);
    }
    return [
      200,
      {
        written: plan.changes.map((change) => change.path),
        backups,
        alreadyDone: plan.alreadyDone,
      },
    ];
  }

  /**
   * `GET /connect` — P4-T6, planned with core's OWN `ConnectPlanner` and the REAL patcher.
   *
   * The same argument `keybindingPlan` makes: the deck is what is under test, so the plan it
   * renders has to be the plan core would produce — down to `JsonFormat` re-printing isg's CRLF
   * settings.json in CRLF, which is the bug G.13 cost a whole-file rewrite to find. What is
   * fixture is only WHERE the files are.
   */
  connectPlan(direction) {
    if (direction !== 'connect' && direction !== 'disconnect')
      return [400, { error: 'bad request' }];
    const planner = this.connectPlanner();
    return [
      200,
      { direction, plan: direction === 'connect' ? planner.connect() : planner.disconnect() },
    ];
  }

  connectWrite(raw) {
    const direction = parseJson(raw)?.direction;
    if (direction !== 'connect' && direction !== 'disconnect')
      return [400, { error: 'bad request' }];

    const planner = this.connectPlanner();
    const plan = direction === 'connect' ? planner.connect() : planner.disconnect();
    if (!plan.ok) return [409, { error: 'refused', reason: 'the plan was refused', applied: [] }];

    this.connectWrites.push(direction);
    const applied = plan.changes.map((change) => {
      this.connectFiles.set(change.path, change.after);
      return { path: change.path, backup: `${change.path}.bak-fixture` };
    });
    if (plan.environment !== 'none') this.ingestKeyPublished = plan.environment === 'publish';
    return [
      200,
      {
        direction,
        applied,
        environment: plan.environment,
        environmentLabel: plan.environmentLabel,
        alreadyDone: plan.alreadyDone,
      },
    ];
  }

  /** Core's planner, over this double's Map and a `SessionEnvironment` that is one boolean. */
  connectPlanner() {
    return new ConnectPlanner({
      settings: SUBSCRIPTION_IDS.map((subscription) => ({
        subscription,
        path: CONNECT_SETTINGS[subscription],
        contents: this.connectFiles.get(CONNECT_SETTINGS[subscription]),
      })),
      statusline: {
        path: CONNECT_STATUSLINE,
        contents: this.connectFiles.get(CONNECT_STATUSLINE),
      },
      patcher: STATUSLINE_PATCHER,
      environment: {
        isPublished: () => this.ingestKeyPublished,
        publish: () => {
          this.ingestKeyPublished = true;
        },
        withdraw: () => {
          this.ingestKeyPublished = false;
        },
        describe: () => '$FLIGHTDECK_TOKEN (user environment)',
      },
    });
  }

  keybindingSources() {
    return [...this.keybindings].map(([path, contents]) => ({
      subscription: path.includes('365') ? '365' : 'isg',
      path,
      contents,
    }));
  }

  mint(raw) {
    const target = parseJson(raw)?.target;
    if (target === undefined) return [400, { error: 'bad request' }];
    const ticket = randomUUID();
    this.tickets.set(ticket, target);
    this.minted.push(target);
    return [201, { ticket }];
  }

  /**
   * Waking a session, with core's own refusals — P4-T2a.
   *
   * The id rule is repeated here rather than waved through, because it is the rule that matters:
   * a short id does not fail at the CLI, it forks a copy (RESEARCH.md F.2.7). A fixture that
   * accepted one would let a deck bug through that core would have caught.
   */
  resume(raw) {
    const fields = parseJson(raw) ?? {};
    const { subscription, sessionId } = fields;
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    if (!known || !full) return [400, { error: 'bad_session' }];
    this.resumes.push({ subscription, sessionId });
    return [200, { sessionId }];
  }

  /**
   * Stopping a session — P4-T2b, with core's refusals.
   *
   * Both ids are required and both shapes are checked, which is what makes the deck-side check
   * real: `stop` takes the SHORT id (RESEARCH.md F.2.8b), so a deck that sent only the uuid, or
   * sliced its own short id badly, is refused here exactly as core would refuse it.
   */
  stopSession(raw) {
    const { sessionId, shortId, subscription } = parseJson(raw) ?? {};
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    const short = typeof shortId === 'string' && SHORT_SESSION_ID.test(shortId);
    if (!known || !full || !short) return [400, { error: 'bad_session' }];
    this.stops.push({ subscription, sessionId, shortId });
    // A real stop ends the session, so the `claude attach` behind any pane exits 0 — which is
    // byte for byte the eviction signal (F.2.6). The double has to do that too, or the smoke
    // cannot see the difference between "you stopped this" and "somebody took this" at all.
    this.endAttached({ kind: 'session', sessionId, subscription });
    return [200, { sessionId }];
  }

  /**
   * Popping a session out to Windows Terminal — P6-T2, with core's refusals and its ORDER.
   *
   * No terminal is opened here and none could be: a CI runner has no Windows Terminal, and
   * what the smoke is checking lives on this side of the wire anyway — that the deck sends the
   * title and the folder, and that the pane goes away because CORE released the hold rather
   * than because the deck removed its own card.
   *
   * So the double does the one thing core does that the browser can see: it ends the attach
   * behind the pane, exactly as `stopSession` does. A deck that closed the card itself would
   * pass a check that only counted cards, and would be guessing at the outcome of a write.
   */
  popOut(raw) {
    const { sessionId, shortId, subscription, title, cwd } = parseJson(raw) ?? {};
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    const short = typeof shortId === 'string' && SHORT_SESSION_ID.test(shortId);
    if (!known || !full || !short) return [400, { error: 'bad_session' }];
    this.popouts.push({ subscription, sessionId, shortId, title, cwd });
    // Detach first, which is the whole of the task: `claude attach` is last-one-wins, so a
    // terminal that attached while the pane still held it would evict it in silence (F.2.6).
    const detached = this.endAttached({ kind: 'session', sessionId, subscription });
    return [200, { detached: detached === true }];
  }

  /**
   * Files two saved presets under one group name — P6-T4.
   *
   * Setup rather than a route, because it stands for something that happened on another day: the
   * owner saved these presets last week. Doing it through the save form would be testing the save
   * form, which `presetChecks` already does, and would put four panel interactions in front of the
   * thing this group is actually about.
   *
   * @param projectPath an imported folder. The presets are filed under it exactly as core files
   * them, so `presetList` merges them with the built-ins the way a real core would.
   */
  seedGroup(projectPath, group = 'morning') {
    const key = projectKey(projectPath);
    // Imported too, if an earlier group withdrew it: a preset is filed under a folder, and this
    // helper stands for a whole day's worth of setup rather than for one click of it.
    if (!this.projects.has(key)) {
      this.projects.set(key, {
        path: projectPath,
        name: projectName(projectPath),
        importedAt: Date.now(),
      });
    }
    for (const [id, name] of [
      ['orchestrator', 'orchestrator'],
      ['reports', 'reports'],
    ]) {
      this.presets.set(`${key}|${id}`, {
        projectKey: key,
        id,
        name,
        profileFn: 'claude-isg-orch',
        cwd: projectPath,
        sessionName: `fd-${id}`,
        promptSource: 'literal',
        prompt: 'go',
        group,
        builtIn: false,
      });
    }
  }

  /**
   * `POST /sessions/group` — P6-T4, D17.
   *
   * **The double starts nothing, and that is the whole reason it exists.** A group press on a real
   * core spends the owner's quota per preset; the half a browser can see is what the palette SENT
   * and what the deck does with the report, and neither needs a session to exist. So this resolves
   * the group out of the same preset list `GET /projects/presets` answers with — through the same
   * `presetGroups` core uses, so a group the deck offers and a group core finds cannot diverge —
   * and reports a made-up id per preset.
   *
   * The FIRST preset of every group is reported as failed, so the partial-failure path the deck
   * has to draw is reachable without arranging for a real launch to go wrong.
   */
  launchGroup(raw) {
    const { group } = parseJson(raw) ?? {};
    if (typeof group !== 'string' || group.trim() === '') return [400, { error: 'bad_request' }];
    if (this.groupBusy) return [409, { error: 'busy' }];
    const found = presetGroups(this.presetList()).find(
      (one) => one.key === group.trim().toLowerCase(),
    );
    if (found === undefined) return [400, { error: 'unknown_group' }];
    if (found.presets.length > MAX_GROUP_LAUNCH) return [400, { error: 'too_many' }];
    this.groupPresses.push(group.trim());
    return [
      200,
      {
        group: found.name,
        outcomes: found.presets.map((preset, index) =>
          index === 0
            ? { presetId: preset.id, name: preset.name, failure: 'launch_failed' }
            : { presetId: preset.id, name: preset.name, sessionId: `fixture-${preset.id}` },
        ),
      },
    ];
  }

  /**
   * Muting a session's Windows toasts — P6-T3.
   *
   * The double keeps the SET rather than a boolean per request, because that is the part of core
   * the browser can see: both routes answer with the whole set, so a deck that edited its own copy
   * would still draw the right switch until the first reply disagreed with it. Screened as core
   * screens it, so a smoke check can send a bad body and get the same 400.
   *
   * No short id, matching `parseMuteRequest`: nothing behind this path names a directory or
   * reaches a command line.
   */
  setMuted(raw) {
    const { sessionId, subscription, muted } = parseJson(raw) ?? {};
    const known = subscription === '365' || subscription === 'isg';
    const full = typeof sessionId === 'string' && FULL_SESSION_ID.test(sessionId);
    if (!known || !full || typeof muted !== 'boolean') return [400, { error: 'bad_session' }];
    if (muted) this.muted.add(`${subscription}:${sessionId}`);
    else this.muted.delete(`${subscription}:${sessionId}`);
    return [200, { muted: [...this.muted].sort() }];
  }

  /** The replay, then nothing until `publish` — exactly core's contract (stream-event.ts). */
  openStream(request, response) {
    response.writeHead(200, STREAM_HEADERS);
    response.write('retry: 2000\n\n');
    this.streams.add(response);
    response.write(`event: snapshot\ndata: ${JSON.stringify(this.fixture.snapshot)}\n\n`);
    response.write(`event: quota\ndata: ${JSON.stringify(this.fixture.quota)}\n\n`);
    request.on('close', () => this.streams.delete(response));
  }

  /**
   * The PTY socket, minus the PTY.
   *
   * The target is read from the upgrade URL and fixed for the life of the socket, and the ticket
   * arrives in the first frame and is burned — the same order core enforces, because that order is
   * what the pane's code path actually exercises (SEC-WS-1, D32). What is different is only what
   * sits behind it: an echo instead of `claude attach`.
   */
  upgrade(request, socket, head) {
    const target = parsePtyTarget(request.url);
    if (target === undefined || !(request.url ?? '').startsWith('/pty')) {
      socket.destroy();
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (client) => {
      this.serve(client, target);
    });
  }

  /** Exits the PTY behind every pane attached to `target`, exactly as a stopped session does. */
  endAttached(target) {
    let ended = false;
    for (const [client, held] of this.attached) {
      if (!sameTarget(held, target)) continue;
      client.send(encode({ type: 'exit', code: 0 }));
      client.close();
      this.attached.delete(client);
      ended = true;
    }
    // P6-T2 reads the answer: a pop-out reports whether a pane was actually detached, and the
    // deck says "detached and popped out" only when one was.
    return ended;
  }

  serve(client, target) {
    let authorised = false;
    const deadline = setTimeout(() => {
      if (!authorised) client.close(1008, 'no_auth');
    }, AUTH_DEADLINE_MS);

    client.on('close', () => {
      clearTimeout(deadline);
      this.attached.delete(client);
    });
    client.on('message', (raw) => {
      const frame = parseClientFrame(String(raw));
      if (frame === undefined) return;
      if (!authorised) {
        authorised = this.admit(client, frame, target);
        return;
      }
      if (frame.type === 'input') {
        this.typed.push(frame.data);
        // `\r` becomes a real newline on the way back, which is what a shell's echo does and what
        // makes a typed line readable in `.xterm-rows` rather than overprinting itself.
        client.send(encode({ type: 'output', data: frame.data.replaceAll('\r', '\r\n') }));
      }
    });
  }

  /** @returns whether the first frame was a ticket minted for THIS target, and burns it if so. */
  admit(client, frame, target) {
    const minted = frame.type === 'auth' ? this.tickets.get(frame.ticket) : undefined;
    if (minted === undefined || !sameTarget(minted, target)) {
      client.close(1008, 'refused');
      return false;
    }
    this.tickets.delete(frame.ticket);
    this.attached.set(client, target);
    client.send(encode({ type: 'ready', pid: 4242, target }));
    client.send(encode({ type: 'output', data: BANNER }));
    return true;
  }
}

function encode(frame) {
  return JSON.stringify(frame);
}

function send(response, status, payload) {
  response.writeHead(status, JSON_HEADERS).end(JSON.stringify(payload));
}

function body(request) {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => resolve(text));
  });
}

function parseJson(raw) {
  try {
    const value = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every instant in the fixture, moved forward by the same amount.
 *
 * One constant offset rather than per-field "minutes ago": the gaps between the timeline's entries
 * and the order of the rows are the fixture, and a per-field rewrite would let them drift apart.
 * This is the scrubber's rule for a captured ISO instant, applied to a hand-written one.
 */
function shiftTimes(fixture) {
  const offset = Date.now() - fixture.baseAt;
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key));
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, held]) => [name, walk(held, name)]),
      );
    }
    return typeof value === 'number' && TIME_KEYS.has(key) ? value + offset : value;
  };
  return walk(fixture, '');
}

/**
 * The fixture, proven against the real parsers — the guarantee a capture would otherwise provide.
 *
 * It throws rather than warns. A double that quietly served a snapshot the deck drops would present
 * as "the deck renders no rows", which is the failure this whole file exists to detect, arriving
 * from the wrong direction.
 */
function validated(fixture) {
  const checks = [
    ['snapshot', parseDeckSnapshot(fixture.snapshot)],
    ['quota', parseQuotaSummary(fixture.quota)],
    ['arriving', parseSessionRow(fixture.arriving)],
    ...Object.entries(fixture.details).map(([id, detail]) => [id, parseSessionDetail(detail)]),
    ...Object.entries(fixture.previews).map(([id, preview]) => [
      `${id} preview`,
      parseSessionPreview(preview),
    ]),
  ];
  const broken = checks.filter(([, parsed]) => parsed === undefined).map(([name]) => name);
  if (broken.length > 0) {
    throw new Error(`fixtures/deck.json no longer matches contracts/: ${broken.join(', ')}`);
  }
  const thinned = countChecks(fixture).filter(([, sent, kept]) => sent !== kept);
  if (thinned.length > 0) {
    throw new Error(
      `fixtures/deck.json has entries the contract parsers drop: ${thinned
        .map(([what, sent, kept]) => `${what} ${String(kept)}/${String(sent)}`)
        .join(', ')}`,
    );
  }
  return fixture;
}

/**
 * How much of each list SURVIVES its parser, not merely whether the whole thing did.
 *
 * Every parser in contracts/ DROPS what it cannot read rather than refusing the whole value — one
 * bad row must not cost the deck the other nine (`parseDeckSnapshot`), and every field below a
 * detail's id is an enrichment (`parseSessionDetail`). That is right for the wire and it makes the
 * check above vacuous on its own: a thinned fixture still parses, so `!== undefined` says yes.
 *
 * Measured: deleting one row's `shortId` refuses the boot with `rows 6/7`. Without this the smoke
 * would have started, rendered six rows, and reported a FIXTURE typo as "the deck is dropping a
 * session" — a bug hunt in the wrong repo layer (RESEARCH.md §G.22).
 *
 * What it does NOT catch, and cannot: a misspelled field INSIDE an entry that still parses. Rename
 * a timeline entry's `state` and the entry survives with `state: undefined`, so the count is
 * unchanged and only an assertion about what is on screen notices. That is why the checks name
 * values (`Waiting on approval`) and not just shapes.
 */
function reading(project) {
  return {
    path: project.path,
    at: Date.now(),
    stack: ['Next.js', 'Node'],
    git: { branch: 'feat/smoke', ahead: 2, behind: 0, dirty: 3, conflicts: 0 },
  };
}

/**
 * One workflow map — P3-T3, SPEC §5.1(a).
 *
 * `app-next`'s shape, cut to one of each thing the panel draws rather than to all 16 assets: what
 * this double exists to prove is that the third request goes out, lands on the right row by
 * `projectKey`, and comes out of `WorkflowMapViewModel` as English. Whether a frontmatter block or
 * a nested `hooks` object parses is settled in tests/contracts.
 *
 * The two hooks share an event on purpose — grouping a run of adjacent rows under one heading is
 * the one thing the panel does to the timeline, and a single hook could not show it.
 */
function workflowMap(project, driftedAt = 0) {
  // Through the deck's own parser, which is this file's rule for every fixture and was not being
  // applied to this one: it was hand-written in P3-T3 with no `ask` on its `PermissionRules`, and
  // nothing noticed for four tasks because nothing in CORE consumed a map from here. P3-T7's
  // historian does, and it crashed on the missing field rather than on anything of its own.
  return parseWorkflowMap({
    path: project.path,
    at: Date.now(),
    instructions: [
      { source: 'user-365', bytes: 683 },
      { source: 'claude-md', bytes: 3482 },
    ],
    assets: [
      { kind: 'agent', name: 'german-ui-expert', description: 'German label to source string.' },
      { kind: 'command', name: 'design-check' },
      { kind: 'skill', name: 'fix-review', tools: ['Bash', 'Read'] },
    ],
    hooks: [
      { event: 'PostToolUse', matcher: 'Edit|Write', command: 'node fast-lint.mjs', async: true },
      {
        event: 'PostToolUse',
        matcher: 'Edit|Write',
        command: 'node check-symbols.mjs',
        timeout: 20,
      },
      { event: 'PreCompact', command: 'node state-dump.mjs', timeout: 15 },
      // P3-T7. The edit the smoke makes: `FixtureCore.driftConfig()` adds a hook and a deny rule,
      // which is what somebody committing a `settings.json` change looks like from out here.
      ...(driftedAt === 0
        ? []
        : [{ event: 'SessionStart', command: 'node warm-cache.mjs', timeout: 10 }]),
    ],
    servers: [{ name: 'chrome-devtools', transport: 'stdio' }],
    plugins: ['context-hygiene@claude-kit'],
    marketplaces: ['claude-kit'],
    permissions: {
      allow: ['Bash(git status:*)', 'Bash(npm run:*)'],
      deny: driftedAt === 0 ? ['Read(.env)'] : ['Read(.env)', 'Read(secrets/**)'],
      ask: [],
      defaultMode: undefined,
    },
    conventions: [
      { folder: 'rules', files: 6 },
      { folder: 'specs', files: 9 },
    ],
    // P3-T4. Three trees so the panel has all three cases in one row: the main checkout, a
    // worktree whose branch repeats its name (drawn without the bracket), and one whose branch
    // differs (drawn with it). Sent linked-first so the smoke proves the deck re-orders.
    worktrees: [
      { id: 'XWEB-1853', path: `${project.path}\\..\\XWEB-1853`, branch: 'XWEB-1853' },
      { id: 'XWEB-1854', path: `${project.path}\\..\\XWEB-1854`, branch: 'feat/rework-the-picker' },
      { id: 'main', path: project.path, branch: 'feat/smoke', isMain: true },
    ],
    // P3-T6. coach-core's gate DEFINITIONS, shaped like the real file (contracts/project-gates.ts):
    // two lint rules named only by their command, two stop checks and four verify steps, and no
    // verdict anywhere in it — which is the whole point of the row the deck draws from this.
    gates: {
      denyPaths: 4,
      askPaths: 1,
      gates: [
        { kind: 'lint', label: 'node scripts/blueprint-lint.js' },
        { kind: 'lint', label: 'node scripts/fs-boundary.js' },
        { kind: 'stop', label: 'unit tests' },
        { kind: 'stop', label: 'typecheck' },
        { kind: 'verify', label: 'typecheck' },
        { kind: 'verify', label: 'lint' },
        { kind: 'verify', label: 'unit tests' },
        { kind: 'verify', label: 'e2e' },
      ],
    },
    configured: true,
  });
}

/**
 * One folder's transcripts, added up — P3-T5, SPEC §5.1(b).
 *
 * Shaped on the real reading this repository's own slug gave (RESEARCH.md G.47) and cut to
 * what the panel draws. Two subscriptions on purpose: a folder worked on from both accounts is
 * the case Flightdeck exists for, and a single share would let a panel that only ever drew the
 * first one pass.
 *
 * `unknownLines` is non-zero on purpose too — it is SPEC §8 R2's drift alarm, and an alarm
 * that is never drawn in any test is an alarm nobody would notice had stopped working.
 */
function observedBehaviour(project) {
  return {
    path: project.path,
    at: Date.now(),
    tookMs: 1149,
    sessions: 42,
    sessionsThisWeek: 9,
    bytesRead: 83_700_000,
    shares: [
      { subscription: '365', sessions: 31, costUsd: 18.4 },
      { subscription: 'isg', sessions: 11, costUsd: 6.05 },
    ],
    tools: [
      { name: 'Read', count: 1204 },
      { name: 'Bash', count: 883 },
      { name: 'Edit', count: 512 },
    ],
    skills: [
      { name: 'ship', count: 27 },
      { name: 'run', count: 14 },
    ],
    sessionNames: [
      { name: 'ledger', count: 583 },
      { name: 'fd-t5-probe', count: 6 },
    ],
    files: [
      { name: 'app/deck/deck-store.ts', count: 61 },
      { name: 'ROADMAP.yaml', count: 44 },
    ],
    medianPeakContextTokens: 137_000,
    compactions: 3,
    scheduledFires: 2,
    unknownLines: 5,
  };
}

function countChecks(fixture) {
  const details = Object.entries(fixture.details).flatMap(([id, detail]) => {
    const parsed = parseSessionDetail(detail);
    return [
      [`${id} timeline`, (detail.timeline ?? []).length, parsed.timeline.length],
      [`${id} tokenTrail`, (detail.tokenTrail ?? []).length, parsed.tokenTrail.length],
      [`${id} files`, (detail.extras?.files ?? []).length, parsed.extras.files.length],
    ];
  });
  // A preview's `lines` are capped and trimmed by `parseSessionPreview`, so a fixture line wider
  // than a real frame or a list longer than a real screen is a fixture the deck would silently
  // shorten — which is the same class of lie the details' counts exist to refuse (P5a-T4).
  const previews = Object.entries(fixture.previews).map(([id, preview]) => [
    `${id} preview lines`,
    preview.lines.length,
    parseSessionPreview(preview).lines.length,
  ]);
  return [
    ['rows', fixture.snapshot.rows.length, parseDeckSnapshot(fixture.snapshot).rows.length],
    ...previews,
    [
      'subscriptions',
      fixture.quota.subscriptions.length,
      parseQuotaSummary(fixture.quota).subscriptions.length,
    ],
    ...details,
  ];
}

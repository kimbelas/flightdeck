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
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CORE_PORT, LOOPBACK_ADDRESS } from '../../contracts/origins.ts';
import { parseProjectPathBody, projectKey, projectName } from '../../contracts/project.ts';
import { parseQuotaSummary } from '../../contracts/quota-summary.ts';
import { parseSessionRef } from '../../contracts/session-ref.ts';
import { parseDeckSnapshot, parseSessionRow } from '../../contracts/session-row.ts';
import { parseSessionDetail } from '../../contracts/session-detail.ts';
import { parseClientFrame, parsePtyTarget, sameTarget } from '../../contracts/pty-protocol.ts';

const FIXTURE = new URL('./fixtures/deck.json', import.meta.url);

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
    /** Every request core answered, so a check can ask what the deck actually sent. */
    this.requests = [];
    /** The bodies of every `POST /sessions`. The launch form's real destination. */
    this.launches = [];
    /**
     * The project registry, as a real core would hold it — P3-T1.
     *
     * A map keyed the way the sqlite table is, so re-importing is a replace rather than a second
     * row, and it starts EMPTY because that is what ships (DECISIONS.md D26). The refusal rules
     * are core's, not this file's: only the shapes the deck can actually produce from a text box
     * are answered here, and the four SEC-FS-1 checks are unit-tested where they live.
     */
    this.projects = new Map();
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
    if (request.method === 'POST' && path === '/sessions') return this.launch(await body(request));
    if (request.method === 'POST' && path === '/pty-ticket') return this.mint(await body(request));
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
      return [200, { maps: [...this.projects.values()].map((held) => workflowMap(held)) }];
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

  forget(raw) {
    const path = parseProjectPathBody(raw);
    if (path === undefined) return [400, { error: 'empty' }];
    return [200, { forgotten: this.projects.delete(projectKey(path)) }];
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

  launch(raw) {
    const request = parseJson(raw);
    if (typeof request?.prompt !== 'string' || request.prompt.trim() === '') {
      return [400, { error: 'bad_request' }];
    }
    this.launches.push(request);
    return [201, { sessionId: randomUUID() }];
  }

  mint(raw) {
    const target = parseJson(raw)?.target;
    if (target === undefined) return [400, { error: 'bad request' }];
    const ticket = randomUUID();
    this.tickets.set(ticket, target);
    this.minted.push(target);
    return [201, { ticket }];
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

  serve(client, target) {
    let authorised = false;
    const deadline = setTimeout(() => {
      if (!authorised) client.close(1008, 'no_auth');
    }, AUTH_DEADLINE_MS);

    client.on('close', () => clearTimeout(deadline));
    client.on('message', (raw) => {
      const frame = parseClientFrame(String(raw));
      if (frame === undefined) return;
      if (!authorised) {
        authorised = this.admit(client, frame, target);
        return;
      }
      if (frame.type === 'input') {
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
function workflowMap(project) {
  return {
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
    ],
    servers: [{ name: 'chrome-devtools', transport: 'stdio' }],
    plugins: ['context-hygiene@claude-kit'],
    marketplaces: ['claude-kit'],
    permissions: { allow: ['Bash(git status:*)', 'Bash(npm run:*)'], deny: ['Read(.env)'] },
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
    configured: true,
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
  return [
    ['rows', fixture.snapshot.rows.length, parseDeckSnapshot(fixture.snapshot).rows.length],
    [
      'subscriptions',
      fixture.quota.subscriptions.length,
      parseQuotaSummary(fixture.quota).subscriptions.length,
    ],
    ...details,
  ];
}

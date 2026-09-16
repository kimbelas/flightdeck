// The deck's client state — CODING-STANDARDS §3 ("React is not exempt from OOP").
//
// A store class with immutable snapshots, bridged to React by `useSyncExternalStore`. Components
// render what this exposes and call its methods; none of the logic below belongs in a component.
//
// **It subscribes; it no longer polls.** P1-T9 gave core an event stream, so the deck's first frame
// is the whole picture and every one after it is a delta — the reconciler sweeps every 10 s and
// what it finds arrives here without anyone asking. `refresh()` survives as a deliberate act rather
// than as the update mechanism: it forces a fresh sweep now, which is also how the `unreadable`
// banner moves (SessionStreamRoute — a subscription core cannot read publishes no event).
//
// **Everything off the wire is parsed, including the two replies that are not frames.** P2-T2
// found `refresh()` and `launch()` casting their JSON straight into state while the stream path
// beside them parsed every frame and dropped what did not match. Same rows, same core, one of them
// checking (CODING-STANDARDS §11 rule 1). They go through `parseDeckSnapshot` and
// `parseLaunchAccepted` now, and through a `DeckApi` port rather than a bare `fetch`, which is
// what makes the paths testable at all.
//
// **The header's gauges arrive here too, and they are whole-state** (P2-T3). `quota` is not a
// delta: quota belongs to a subscription, the deck draws both at once, and core decides which of a
// subscription's sessions represents it (`summariseQuota`). So the frame replaces what is held
// rather than merging into it, and it is replayed on connect — which is what fills the header on an
// idle machine, where nothing renders a status line and therefore nothing publishes.
//
// **Reconnection is this class's job, not the browser's.** An `EventSource` retries a dropped
// connection on its own but gives up permanently on an HTTP error, and "core is not running" is
// exactly that: the route handler answers 503 (RESEARCH.md F.6.7). Since core restarting is an
// ordinary event on this machine (F.3.3), a deck that stopped retrying would be a deck that needs
// a page reload every time. One path for both cases: close, wait, reopen.
import {
  CORE_PROJECT_FORGET_PATH,
  CORE_PROJECT_STATUS_PATH,
  CORE_PROJECTS_PATH,
  CORE_SESSION_PATH,
  CORE_SESSIONS_PATH,
} from '../../contracts/deck-routes.ts';
import { parseImportRefusal, parseProjectList, projectKey } from '../../contracts/project.ts';
import { parseProjectStatusList, type ProjectStatus } from '../../contracts/project-status.ts';
import {
  parseLaunchAccepted,
  parseLaunchFailure,
  type LaunchAccepted,
} from '../../contracts/launch-reply.ts';
import { parseSessionDetail, type SessionDetail } from '../../contracts/session-detail.ts';
import { sessionRefQuery, type SessionRef } from '../../contracts/session-ref.ts';
import {
  byAttentionThenAge,
  parseDeckSnapshot,
  sessionKey,
  type DeckSnapshot,
  type SessionRow,
} from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckApi, JsonReply } from './deck-api.ts';
import { WorkflowMapSlice } from './workflow-map-slice.ts';
import {
  EMPTY,
  type DeckState,
  type EventStreamSource,
  type StreamTransport,
} from './deck-state.ts';
import {
  DECK_STREAM_PATH,
  parseStreamFrame,
  STREAM_FRAME_NAMES,
  type StreamFrameName,
} from '../../contracts/stream-event.ts';

// Re-exported so the twelve files that already import these from here did not have to move. The
// split was for the line count; it is not a new boundary (deck-state.ts).
export type { DeckState, EventStreamSource, StreamTransport } from './deck-state.ts';

/** Matches core's own `retry:` hint (SseStream). Loopback; there is nothing to back off from. */
const RECONNECT_MS = 2000;

const UNREACHABLE = 'Could not reach flightdeck-core.';

/** Said out loud rather than swallowed: a reply nobody can parse is not an empty session list. */
const UNREADABLE = 'flightdeck-core answered something the deck could not read.';

export class DeckStore {
  private readonly subscribers = new Set<() => void>();
  private readonly transport: StreamTransport;
  private readonly api: DeckApi;
  /** The third fetch path, in a class of its own — see `workflow-map-slice.ts` on why (P3-T3). */
  private readonly workflowMaps: WorkflowMapSlice;
  private state: DeckState = EMPTY;
  private source: EventStreamSource | undefined;
  private cancelRetry: (() => void) | undefined;

  constructor(transport: StreamTransport, api: DeckApi) {
    this.transport = transport;
    this.api = api;
    this.workflowMaps = new WorkflowMapSlice(api, (maps) => {
      this.set({ maps });
    });
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** A stable reference per state, which is what `useSyncExternalStore` requires. */
  public snapshot = (): DeckState => this.state;

  /**
   * Opens the stream. Idempotent — a second call while one is open does nothing.
   *
   * Idempotent because React's StrictMode mounts an effect twice in development, and two
   * connections would be two subscriptions at core and two snapshots racing into this state.
   */
  public connect(): void {
    if (this.source !== undefined) return;
    this.set({ loading: true });
    const source = this.transport.open(DECK_STREAM_PATH);
    this.source = source;
    for (const name of STREAM_FRAME_NAMES) {
      source.on(name, (data) => {
        this.receive(name, data);
      });
    }
    source.on('error', () => {
      this.reopenLater();
    });
  }

  /** Closes the stream and cancels any pending retry. Idempotent. */
  public disconnect(): void {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.source?.close();
    this.source = undefined;
  }

  /**
   * Sweeps both subscriptions now, through the same-origin rewrite.
   *
   * It does not move the gauges, and nothing here should make it: `GET /sessions` answers the
   * session table and quota is not in it. The header's numbers are the stream's to update — a
   * second path to them would be a second opinion, and a `refresh` button that quietly re-fetched
   * everything is how the polling loop P1-T9 removed would grow back.
   *
   * **It does re-read the projects** (P3-T2), and that is not the same re-fetch. Quota has a
   * stream frame of its own and a second path to it would be a second opinion; the registry and
   * its git readings have no frame at all — nothing pushes them, by design — so the deliberate act
   * is the only thing that can move them. A refresh button that left a branch name from ten
   * minutes ago on screen would be a button that did not refresh.
   *
   * The token never appears here: `/api/core/*` is proxied server-side and `proxy.ts` attaches the
   * bearer on the way (SEC-HTTP-5). Only the PTY socket needs a credential in the page, and it is
   * a ticket rather than the token (D32).
   */
  public async refresh(): Promise<void> {
    this.set({ loading: true, error: undefined });
    // In parallel: the two answers are independent, and a sweep of both subscriptions is the slow
    // one. Nothing here throws, so neither can lose the other's result.
    const [reply] = await Promise.all([this.api.get(CORE_SESSIONS_PATH), this.loadProjects()]);
    // Core down is an ordinary state the deck renders, not an exception (RESEARCH.md F.3.3).
    if (reply === undefined) {
      this.fail(UNREACHABLE);
      return;
    }
    if (reply.status !== 200) {
      this.fail(describe(reply.status));
      return;
    }
    // A 200 that is not a snapshot is core answering with something else, or Next answering with
    // an HTML error page. Neither is a session list, and neither used to be noticed.
    const snapshot = parseDeckSnapshot(reply.body);
    if (snapshot === undefined) {
      this.set({ loading: false, error: UNREADABLE });
      return;
    }
    this.apply(snapshot);
  }

  /**
   * Starts a background session.
   *
   * Nothing is fetched afterwards: the reconciler's next sweep publishes the new session as a
   * `session.upsert` and it arrives on the stream. A launch that returned an id core has not seen
   * yet is exactly the case P1-T4's two-sweep rule exists for (RESEARCH.md G.2).
   *
   * @returns the new session's id, or `undefined` if it could not start.
   */
  public async launch(
    subscription: SubscriptionId,
    prompt: string,
    name: string | undefined,
  ): Promise<string | undefined> {
    this.set({ loading: true, error: undefined });
    const reply = await this.api.post(CORE_SESSIONS_PATH, { subscription, prompt, name });
    const started = reply === undefined ? undefined : whatStarted(reply);
    if (started !== undefined) {
      this.set({ loading: false });
      return started.sessionId;
    }
    // Not `coreUp: false`: the stream is the authority on that, and a refused launch says nothing
    // about whether core is there — it usually means it answered.
    this.set({ loading: false, error: whyNotLaunched(reply) });
    return undefined;
  }

  /**
   * Fetches one session's detail for an expanded row — P2-T4.
   *
   * A REQUEST, deliberately, where everything else here is a frame. The rows are the picture of the
   * machine and belong on the stream; a detail is one session that one person just clicked, and
   * broadcasting every expansion's worth of model text to every open deck would be pushing SEC-UI-2
   * material nobody asked for.
   *
   * **Re-asked on every expand, never cached past a collapse.** `state.json` and `timeline.jsonl`
   * move while the row is open, and a detail from four minutes ago that looks current is worse than
   * a spinner. Collapsing drops it (`forget`), so re-expanding is a fresh read.
   */
  public async expand(ref: SessionRef): Promise<void> {
    const key = `${ref.subscription}:${ref.sessionId}`;
    // Marked as asked BEFORE the await, so a second click while the first is in flight does not
    // start a second request and the row can draw its spinner immediately.
    if (key in this.state.details) return;
    this.setDetail(key, undefined);
    const reply = await this.api.get(`${CORE_SESSION_PATH}?${sessionRefQuery(ref)}`);
    if (reply?.status !== 200) {
      // The row stays expanded with nothing in it rather than snapping shut under the pointer: a
      // detail that could not be read is a thing to say, and `SessionDetailView` says it.
      return;
    }
    const detail = parseSessionDetail(reply.body);
    // A body that is not a detail is dropped exactly as an unparseable frame is (§11 rule 1) —
    // and it must not be rendered against this row, because the one field that is required is the
    // session id that says which row it belongs to.
    if (detail?.sessionId !== ref.sessionId) return;
    this.setDetail(key, detail);
  }

  /**
   * Re-reads the project registry — P3-T1.
   *
   * Called once when the deck mounts and after every import or withdrawal, rather than polled: the
   * registry moves only when somebody uses this page, so there is nothing to discover on a timer.
   *
   * A reply that cannot be read leaves the held list alone rather than emptying it. An empty
   * registry is a real and ordinary state (D26), so rendering one because a request failed would
   * tell the owner their projects are gone.
   */
  public async loadProjects(): Promise<void> {
    const reply = await this.api.get(CORE_PROJECTS_PATH);
    if (reply?.status !== 200) return;
    this.set({ projects: parseProjectList(reply.body) });
    // In parallel: two independent reads of the same list, and the map is by far the slower of the
    // two. Neither throws, so neither can lose the other's result.
    await Promise.all([this.loadProjectStatuses(), this.workflowMaps.load()]);
  }

  /**
   * Re-reads stack and git for every imported folder — P3-T2.
   *
   * A second request rather than more fields on the first, because the two cost different things:
   * listing the registry opens nothing, and this one may spawn a `git` per project. Core holds
   * each reading for four seconds (`SignatureCache`), so asking again straight away is cheap and
   * asking rarely is what keeps it accurate.
   *
   * **Replaced wholesale, never merged.** Core answers about every imported project, so a merge
   * would leave a branch name on screen for a folder that has just been forgotten.
   *
   * A reply that cannot be read leaves what is held alone, exactly as `loadProjects` does: an
   * empty answer is a real state, and rendering one because a request failed would say every
   * project stopped being a repository.
   */
  public async loadProjectStatuses(): Promise<void> {
    const reply = await this.api.get(CORE_PROJECT_STATUS_PATH);
    if (reply?.status !== 200) return;
    this.set({ statuses: byProject(parseProjectStatusList(reply.body)) });
  }

  /**
   * Imports one folder by path — the owner's deliberate act (DECISIONS.md D26).
   *
   * @returns whether it was imported. The refusal, when there is one, goes into `importRefusal`
   * for `ProjectsViewModel` to put into English — it is core's own closed union, not a sentence
   * core composed, so nothing displayed here came from the request.
   */
  public async importProject(path: string): Promise<boolean> {
    this.set({ importRefusal: undefined });
    const reply = await this.api.post(CORE_PROJECTS_PATH, { path });
    if (reply?.status === 201) {
      await this.loadProjects();
      return true;
    }
    // `undefined` for a request that reached nobody, and for a 400 carrying a code this build does
    // not know — both render as the generic sentence rather than as silence.
    this.set({ importRefusal: parseImportRefusal(reply?.body) ?? 'empty' });
    return false;
  }

  /**
   * Withdraws one folder, taking the read permission with it.
   *
   * The list is re-read rather than filtered locally: what the registry holds is core's answer,
   * and a deck that removed the row itself would be guessing at the outcome of a write.
   */
  public async forgetProject(path: string): Promise<void> {
    const reply = await this.api.post(CORE_PROJECT_FORGET_PATH, { path });
    if (reply === undefined) return;
    await this.loadProjects();
  }

  /** Drops one detail, on collapse. See `expand` for why nothing is kept. */
  public forget(key: string): void {
    if (!(key in this.state.details)) return;
    // Rebuilt without the key rather than `delete`d: absent and "asked, waiting" are different
    // states here — the spinner is drawn from the second — so the key has to GO, not become
    // `undefined`, and a filtered rebuild says that without a dynamic delete.
    const details = Object.fromEntries(
      Object.entries(this.state.details).filter(([held]) => held !== key),
    );
    this.set({ details });
  }

  private setDetail(key: string, detail: SessionDetail | undefined): void {
    this.set({ details: { ...this.state.details, [key]: detail } });
  }

  /** One frame. Anything that does not parse is dropped rather than rendered (§11 rule 1). */
  private receive(name: StreamFrameName, data: string): void {
    const frame = parseStreamFrame(name, data);
    if (frame === undefined) return;
    switch (frame.name) {
      case 'snapshot':
        this.apply(frame.data);
        return;
      case 'session.upsert':
        this.set({ rows: upsert(this.state.rows, frame.data), coreUp: true, loading: false });
        return;
      case 'session.gone':
        this.set({ rows: without(this.state.rows, sessionKey(frame.data)) });
        return;
      // Replaced, never merged: core sends the whole picture for both subscriptions, and half of
      // an older one beside half of a newer one is a reading that was never taken.
      case 'quota':
        this.set({ quota: frame.data, coreUp: true });
        return;
    }
  }

  private apply(snapshot: DeckSnapshot): void {
    this.set({
      rows: snapshot.rows,
      unreadable: snapshot.unreadable,
      coreUp: true,
      loading: false,
      error: undefined,
    });
  }

  /** Dropped, or refused — the page cannot tell those apart, and does not need to. */
  private reopenLater(): void {
    if (this.source === undefined) return;
    this.source.close();
    this.source = undefined;
    this.set({ coreUp: false, loading: false, error: 'flightdeck-core is not answering.' });
    this.cancelRetry = this.transport.wait(RECONNECT_MS, () => {
      this.cancelRetry = undefined;
      this.connect();
    });
  }

  /** A request that reached nobody, or an answer that was not one. The rows stay; they are still
   * the best answer anyone has. */
  private fail(error: string): void {
    this.set({ loading: false, coreUp: false, error });
  }

  private set(changes: Partial<DeckState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.subscribers) listener();
  }
}

/** Readings by `projectKey`, which is the same key the panel draws its rows under. */
function byProject(statuses: readonly ProjectStatus[]): Readonly<Record<string, ProjectStatus>> {
  return Object.fromEntries(statuses.map((status) => [projectKey(status.path), status]));
}

/** Replaces the row if it is already known, appends it if not, and re-sorts either way. */
function upsert(rows: readonly SessionRow[], row: SessionRow): readonly SessionRow[] {
  return [...without(rows, sessionKey(row)), row].sort(byAttentionThenAge);
}

function without(rows: readonly SessionRow[], key: string): readonly SessionRow[] {
  return rows.filter((row) => sessionKey(row) !== key);
}

/**
 * The session a launch actually started, or `undefined` for a reply that did not start one.
 *
 * 201 exactly: core answers `created` for a session that now exists, and anything else — a 200
 * included — is not one (LaunchRoute).
 */
function whatStarted(reply: JsonReply): LaunchAccepted | undefined {
  return reply.status === 201 ? parseLaunchAccepted(reply.body) : undefined;
}

/**
 * Why it did not, preferring core's own code to the status it came under.
 *
 * The status alone lies here. `no_claude` is a 503, and `describe` reads a 503 as "core is not
 * running" — which is exactly wrong: core is running, it answered, and it cannot find claude.exe.
 * That is the operator's to fix and the only one of the three codes worth repeating; the other two
 * describe the request, which the owner cannot act on.
 */
function whyNotLaunched(reply: JsonReply | undefined): string {
  if (reply === undefined) return UNREACHABLE;
  const failure = parseLaunchFailure(reply.body);
  if (failure === 'no_claude') {
    return 'Core is running but cannot find claude.exe — run `npm run doctor`.';
  }
  if (failure !== undefined) return 'Core would not start that session.';
  // A 201 that got this far carried something other than a session id.
  return reply.status === 201 ? UNREADABLE : describe(reply.status);
}

function describe(status: number): string {
  if (status === 503) return 'flightdeck-core is not running.';
  if (status === 401 || status === 403)
    return 'Core refused the request — restart it to reissue the token.';
  return `Core answered ${String(status)}.`;
}

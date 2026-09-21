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
  CORE_REMOVE_PATH,
  CORE_RESUME_PATH,
  CORE_SESSIONS_PATH,
  CORE_STOP_PATH,
} from '../../contracts/deck-routes.ts';
import type { PresetDraft, PresetLaunch, PresetRef } from '../../contracts/launch-preset.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import {
  byAttentionThenAge,
  parseDeckSnapshot,
  sessionKey,
  type DeckSnapshot,
  type SessionRow,
} from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckApi } from './deck-api.ts';
import {
  describeStatus,
  UNREACHABLE,
  UNREADABLE,
  whatStarted,
  whyNotLaunched,
  whyNotRemoved,
  whyNotResumed,
  whyNotStopped,
} from './deck-replies.ts';
import { DetailSlice } from './detail-slice.ts';
import { PresetsSlice } from './presets-slice.ts';
import { PreviewSlice } from './preview-slice.ts';
import { ProjectsSlice } from './projects-slice.ts';
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

export class DeckStore {
  private readonly subscribers = new Set<() => void>();
  private readonly transport: StreamTransport;
  private readonly api: DeckApi;
  /** The third fetch path, in a class of its own — see `workflow-map-slice.ts` on why (P3-T3). */
  private readonly workflowMaps: WorkflowMapSlice;
  /** The fourth, split for the same reason — see `preview-slice.ts` (P5a-T4). */
  private readonly previews: PreviewSlice;
  /** The fifth — see `presets-slice.ts` (P4-T1). */
  private readonly presets: PresetsSlice;
  /** The registry and its readings, lifted out for the line count when the fifth arrived. */
  private readonly projects: ProjectsSlice;
  /** The preview's twin, split out for the same reason — see `detail-slice.ts` (P4-T2). */
  private readonly details: DetailSlice;
  private state: DeckState = EMPTY;
  private source: EventStreamSource | undefined;
  private cancelRetry: (() => void) | undefined;

  constructor(transport: StreamTransport, api: DeckApi) {
    this.transport = transport;
    this.api = api;
    this.workflowMaps = new WorkflowMapSlice(api, (maps) => {
      this.set({ maps });
    });
    this.previews = new PreviewSlice(api, (previews) => {
      this.set({ previews });
    });
    this.presets = new PresetsSlice(api, (changes) => {
      this.set(changes);
    });
    this.projects = new ProjectsSlice(api, (changes) => {
      this.set(changes);
    });
    this.details = new DetailSlice(api, (details) => {
      this.set({ details });
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
      this.fail(describeStatus(reply.status));
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
  public async launch(request: PresetLaunch): Promise<string | undefined> {
    this.set({ loading: true, error: undefined });
    const reply = await this.api.post(CORE_SESSIONS_PATH, request);
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
   * Deletes a background session and its conversation — P4-T2.
   *
   * Nothing is fetched afterwards, for `launch`'s reason: the reconciler's next sweep publishes
   * `session.gone` and the row disappears then. A deleted row therefore lingers for a sweep, which
   * is honest — it is gone once core has seen that it is gone, and a deck that removed the row
   * itself would be guessing at the outcome of the one write that cannot be undone.
   *
   * The confirm step is the ROW's (`SessionRowCard`), not this method's: a store method that asked
   * would be one nothing else could call.
   *
   * @returns whether core deleted it.
   */
  public async remove(ref: SessionRef): Promise<boolean> {
    this.set({ loading: true, error: undefined });
    const reply = await this.api.post(CORE_REMOVE_PATH, ref);
    if (reply?.status === 200) {
      this.set({ loading: false });
      return true;
    }
    this.set({ loading: false, error: whyNotRemoved(reply) });
    return false;
  }

  /**
   * Saves one preset for a project, then re-reads the list. See `PresetsSlice` for the rule.
   *
   * @returns whether core saved it. The refusal goes into `presetRefusal` for the panel.
   */
  public savePreset = (draft: PresetDraft): Promise<boolean> => this.presets.save(draft);

  /** Removes one saved preset. The built-in it was shadowing comes back. */
  public forgetPreset = (ref: PresetRef): Promise<void> => this.presets.forget(ref);

  /**
   * Wakes a stopped background session so a pane can attach to it — P4-T2a.
   *
   * Nothing is fetched afterwards, for `launch`'s reason: the reconciler's next sweep publishes the
   * woken session as a `session.upsert` and it arrives on the stream. So the row goes on saying
   * "not running" for a sweep, which is honest — it is not running until core has seen that it is.
   *
   * @returns whether core woke it.
   */
  public async resume(subscription: SubscriptionId, sessionId: string): Promise<boolean> {
    this.set({ loading: true, error: undefined });
    const reply = await this.api.post(CORE_RESUME_PATH, { subscription, sessionId });
    if (reply?.status === 200) {
      this.set({ loading: false });
      return true;
    }
    this.set({ loading: false, error: whyNotResumed(reply) });
    return false;
  }

  /**
   * Stops a running background session, without deleting it — P4-T2b.
   *
   * Nothing is fetched afterwards, for `launch`'s reason: the reconciler's next sweep publishes the
   * change and it arrives on the stream. So the row goes on saying "running" for a sweep, which is
   * honest — it is running until core has seen that it is not.
   *
   * The whole ref goes over, both ids: `stop` takes the SHORT one (RESEARCH.md F.2.8b) and the deck
   * does not derive it (contracts/session-ref.ts).
   *
   * @returns whether core stopped it.
   */
  public async stop(ref: SessionRef): Promise<boolean> {
    this.set({ loading: true, error: undefined });
    const reply = await this.api.post(CORE_STOP_PATH, ref);
    if (reply?.status === 200) {
      this.set({ loading: false });
      return true;
    }
    this.set({ loading: false, error: whyNotStopped(reply) });
    return false;
  }

  /**
   * Re-reads the project registry and everything annotating it — P3-T1, P3-T2, P3-T3, P4-T1.
   *
   * Called once when the deck mounts and after every import or withdrawal, rather than polled: the
   * registry moves only when somebody uses this page, so there is nothing to discover on a timer.
   * The three readings ride along only when the registry itself was readable — a list nobody could
   * read has nothing to annotate (`ProjectsSlice.load`).
   */
  public async loadProjects(): Promise<void> {
    if (!(await this.projects.load())) return;
    // In parallel: three independent reads of the same list, and the map is by far the slowest.
    // None of them throws, so none can lose another's result.
    await Promise.all([
      this.projects.loadStatuses(),
      this.workflowMaps.load(),
      this.presets.load(),
    ]);
  }

  /** Stack and git for every imported folder — P3-T2. See `ProjectsSlice` for the rules. */
  public loadProjectStatuses = (): Promise<void> => this.projects.loadStatuses();

  /**
   * Imports one folder by path — the owner's deliberate act (DECISIONS.md D26).
   *
   * @returns whether it was imported. The refusal goes into `importRefusal` for the panel.
   */
  public async importProject(path: string): Promise<boolean> {
    const imported = await this.projects.import(path);
    if (imported) await this.loadProjects();
    return imported;
  }

  /** Withdraws one folder, taking the read permission — and its presets — with it. */
  public async forgetProject(path: string): Promise<void> {
    if (await this.projects.forget(path)) await this.loadProjects();
  }

  /**
   * Fetches one session's detail for an expanded row — P2-T4. See `DetailSlice` for the rules.
   */
  public async expand(ref: SessionRef): Promise<void> {
    await this.details.read(ref);
  }

  /**
   * Reads one session's screen — P5a-T4. See `PreviewSlice`, which owns the shape and the rule.
   *
   * The one thing worth repeating at the call site is that this is NOT part of `expand` — a
   * preview spawns `claude logs` and waits 2.7 s for 330 KB (RESEARCH.md F.2.5), so it happens on
   * a press and at no other time.
   */
  public async preview(ref: SessionRef): Promise<void> {
    await this.previews.read(ref);
  }

  /**
   * Drops one detail and its preview, on collapse.
   *
   * The preview goes with the detail for the stronger version of the same reason: a screen from
   * four minutes ago that looks current is worse than a button, and a preview is the one thing
   * here that is a photograph rather than a reading.
   */
  public forget(key: string): void {
    this.previews.forget(key);
    this.details.forget(key);
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

/** Replaces the row if it is already known, appends it if not, and re-sorts either way. */
function upsert(rows: readonly SessionRow[], row: SessionRow): readonly SessionRow[] {
  return [...without(rows, sessionKey(row)), row].sort(byAttentionThenAge);
}

function without(rows: readonly SessionRow[], key: string): readonly SessionRow[] {
  return rows.filter((row) => sessionKey(row) !== key);
}

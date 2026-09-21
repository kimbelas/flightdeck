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
import { CORE_SESSIONS_PATH } from '../../contracts/deck-routes.ts';
import type { PresetDraft, PresetLaunch, PresetRef } from '../../contracts/launch-preset.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import { parseDeckSnapshot, sessionKey, type DeckSnapshot } from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckApi } from './deck-api.ts';
import {
  describeStatus,
  UNREACHABLE,
  UNREADABLE,
  whatStarted,
  whyNotLaunched,
} from './deck-replies.ts';
import { AskSlice } from './ask-slice.ts';
import { InstallSlice } from './install-slice.ts';
import { LifecycleSlice } from './lifecycle-slice.ts';
import { GroupSlice } from './group-slice.ts';
import { MuteSlice } from './mute-slice.ts';
import { upsert, without } from './session-rows.ts';
import type { AskRequest } from '../../contracts/ask-run.ts';
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
  /**
   * The version chip's panel — P4-T5. Nothing is read until it is opened.
   *
   * Exposed rather than re-wrapped, unlike the other five slices. They are wrapped because the
   * store adds something on the way past — a loading flag, a cascade, a re-read. It adds nothing
   * to these three, and three methods that only forward would be three more places to keep in
   * step for no reader's benefit.
   */
  public readonly install: InstallSlice;
  private readonly subscribers = new Set<() => void>();
  private readonly transport: StreamTransport;
  private readonly api: DeckApi;
  /** The third fetch path, in a class of its own — see `workflow-map-slice.ts` on why (P3-T3). */
  private readonly workflowMaps: WorkflowMapSlice;
  /** The fourth, split for the same reason — see `preview-slice.ts` (P5a-T4). */
  private readonly previews: PreviewSlice;
  /** The fifth — see `presets-slice.ts` (P4-T1). */
  private readonly presets: PresetsSlice;
  /**
   * The registry and its readings, lifted out for the line count when the fifth arrived.
   *
   * It owns the sixth fetch path too, as of P3-T5: a transcript reading is a reading OF a
   * project, and it is withdrawn by the same act that withdraws the folder.
   */
  private readonly projects: ProjectsSlice;
  /** The preview's twin, split out for the same reason — see `detail-slice.ts` (P4-T2). */
  private readonly details: DetailSlice;
  /** The Ask panel — P4-T4. Two inputs: it POSTs, and the stream tells it the answer. */
  private readonly asks: AskSlice;
  /** Resume, stop, pop out, delete — one shape four times (P6-T2). */
  private readonly lifecycle: LifecycleSlice;
  /** Which sessions core stops toasting about — P6-T3. Read on connect, written by a pane. */
  private readonly mutes: MuteSlice;
  /** Pressing a preset group — P6-T4. The one button that starts N sessions at once. */
  private readonly groups: GroupSlice;
  private state: DeckState = EMPTY;
  private source: EventStreamSource | undefined;
  private cancelRetry: (() => void) | undefined;

  constructor(transport: StreamTransport, api: DeckApi) {
    this.transport = transport;
    this.api = api;
    this.workflowMaps = new WorkflowMapSlice(api, (held) => {
      this.set(held);
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
    this.asks = new AskSlice(api, (changes) => {
      this.set(changes);
    });
    this.install = new InstallSlice(api, (changes) => {
      this.set(changes);
    });
    this.details = new DetailSlice(api, (details) => {
      this.set({ details });
    });
    this.lifecycle = new LifecycleSlice(api, (changes) => {
      this.set(changes);
    });
    this.mutes = new MuteSlice(api, (muted) => {
      this.set({ muted });
    });
    this.groups = new GroupSlice(api, (changes) => {
      this.set(changes);
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
    // P6-T3, and it is a read rather than a stream frame because nothing pushes it: a mute moves
    // only when somebody presses the switch, and the one press that is not this page's is another
    // tab's. Not awaited — the stream is what the deck is here for, and a set that arrives a
    // moment later draws a switch that was already in the right position for all but new panes.
    void this.mutes.load();
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
    // In parallel: the three answers are independent, and a sweep of both subscriptions is by far
    // the slow one. Nothing here throws, so none of them can lose another's result.
    const [reply] = await Promise.all([
      this.api.get(CORE_SESSIONS_PATH),
      this.loadProjects(),
      // P6-T3, and here for the projects' reason rather than the quota's: the mute set has no
      // stream frame, by design — nothing pushes it — so the deliberate act is the only thing that
      // can move a switch another tab flipped.
      this.mutes.load(),
    ]);
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
   * The four verbs that change what a session IS — see `lifecycle-slice.ts` for the rules.
   *
   * None of them re-reads anything: the reconciler's next sweep publishes the change and it
   * arrives on the stream, so a row goes on saying "running" for a sweep after it was stopped.
   * That is honest — it is running until core has seen that it is not.
   */
  public remove = (ref: SessionRef): Promise<boolean> => this.lifecycle.remove(ref);

  /**
   * Saves one preset for a project, then re-reads the list. See `PresetsSlice` for the rule.
   *
   * @returns whether core saved it. The refusal goes into `presetRefusal` for the panel.
   */
  public savePreset = (draft: PresetDraft): Promise<boolean> => this.presets.save(draft);

  /** Removes one saved preset. The built-in it was shadowing comes back. */
  public forgetPreset = (ref: PresetRef): Promise<void> => this.presets.forget(ref);

  /** Asks one headless question. Accepted in milliseconds; the answer arrives on the stream. */
  public ask = (draft: AskRequest): Promise<boolean> => this.asks.ask(draft);

  /** Clears the Ask panel. The run is core's and keeps going — closing a panel cancels nothing. */
  public clearAsk = (): void => {
    this.asks.clear();
  };

  /** Wakes a stopped background session so a pane can attach to it — P4-T2a. */
  public resume = (subscription: SubscriptionId, sessionId: string): Promise<boolean> =>
    this.lifecycle.resume(subscription, sessionId);

  /** Stops a running background session, without deleting it — P4-T2b. */
  public stop = (ref: SessionRef): Promise<boolean> => this.lifecycle.stop(ref);

  /** Hands a session to Windows Terminal, detaching its pane first — P6-T2. */
  public popOut = (ref: SessionRef, title: string, cwd: string | undefined): Promise<boolean> =>
    this.lifecycle.popOut(ref, title, cwd);

  /**
   * Silences, or unsilences, one session's Windows toasts — P6-T3.
   *
   * `muted` is the position asked for rather than a toggle, and the set that comes back is core's
   * rather than this page's guess at it (`MuteSlice`).
   */
  /**
   * Starts every preset in a named group — P6-T4, D17.
   *
   * @returns whether core ACCEPTED the press, not whether every session started. What started is
   * in `groupReport`, because three of four is the normal shape of a bad morning.
   */
  public launchGroup = (group: string): Promise<boolean> => this.groups.launch(group);

  /** Dismisses the last group press. */
  public clearGroup = (): void => {
    this.groups.clear();
  };

  public setMuted = (
    subscription: SubscriptionId,
    sessionId: string,
    muted: boolean,
  ): Promise<void> => this.mutes.set(subscription, sessionId, muted);

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

  /**
   * Reads one folder's transcripts — P3-T5. See `ObservedSlice` for the rules.
   *
   * On a press and at no other time: 90 MB and ~1 s for this repository's own folder, which is the
   * same bargain `preview` makes about `claude logs`.
   */
  public observe = (path: string): Promise<void> => this.projects.observe(path);

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

  /**
   * Withdraws one folder, taking the read permission — and its presets and its reading — with it.
   *
   * The reading is dropped inside `ProjectsSlice.forget`, for the reason P3-T2 gave about the
   * git line: a cache that outlived the permission would be the deck showing what it is no
   * longer allowed to look at.
   */
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
      // Not replayed on connect, unlike the two above: an Ask record is an event in a conversation
      // rather than a picture of the machine (stream-event.ts).
      case 'ask':
        this.asks.receive(frame.data);
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

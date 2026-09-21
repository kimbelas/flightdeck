// What the deck holds, and what it needs from the browser to hold it — split out of `deck-store.ts`
// in P3-T2.
//
// The same division `routes.ts` made out of `main.ts`, and for the same reason: that file has a
// 250-line limit and reached it, and of what it does, this is a piece with a story of its own. The
// store is BEHAVIOUR — connect, parse, retry, fetch. This is the SHAPE it keeps and the two
// interfaces it needs a browser for, which is the part every other file in `app/deck/` reads and
// the part that grows by a field with every phase.
//
// `deck-store.ts` re-exports all three, so nothing that already imported them from there had to
// change. That is deliberate rather than lazy: this is a split for the line count, not a new
// boundary, and moving twelve import sites to prove it would be churn with no reader behind it.
import type { AskRefusal } from '../../contracts/ask-run.ts';
import type { InstallHealth, UpdateResult } from '../../contracts/install-health.ts';
import type { RespawnReport } from './install-slice.ts';
import type { AskRun } from './ask-slice.ts';
import type { LaunchPreset, PresetRefusal } from '../../contracts/launch-preset.ts';
import type { ConfigDrift } from '../../contracts/config-snapshot.ts';
import type { ObservedBehaviour } from '../../contracts/observed-behaviour.ts';
import type { ImportRefusal, ProjectRecord } from '../../contracts/project.ts';
import type { ProjectStatus } from '../../contracts/project-status.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import type { SessionDetail } from '../../contracts/session-detail.ts';
import type { SessionPreview } from '../../contracts/session-preview.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

export interface DeckState {
  readonly rows: readonly SessionRow[];
  readonly unreadable: readonly SubscriptionId[];
  /** Both subscriptions' gauges, or `undefined` until the first `quota` frame (P2-T3). */
  readonly quota: QuotaSummary | undefined;
  /**
   * The Ask run this deck started, or `undefined` until somebody asks something — P4-T4.
   *
   * One, not a list: core runs one at a time (`AskRunner`), and a panel that kept a history would
   * be keeping model text nobody asked to have kept.
   */
  readonly ask: AskRun | undefined;
  /** Why the last Ask was refused, as core's code. `undefined` once one is accepted. */
  readonly askRefusal: AskRefusal | undefined;
  /**
   * What `claude doctor` said per subscription — P4-T5.
   *
   * Keyed and empty until the chip is pressed: doctor costs ~2 s per account (F.10.1), and a key
   * present with `undefined` means asked-and-waiting, as it does for details and previews.
   */
  readonly health: Readonly<Record<string, InstallHealth | undefined>>;
  /** What the last update attempt said. Almost always "already up to date" — auto-updates are on. */
  readonly update: UpdateResult | undefined;
  /** Which sessions the last respawn actually restarted. `--all` is not all (F.10.4). */
  readonly respawn: RespawnReport | undefined;
  /**
   * The expanded rows' details, keyed by `sessionKey` — P2-T4.
   *
   * Keyed rather than a single `expanded`, because more than one row can be open and closing one
   * must not throw away the others. A key present with `undefined` means "asked, still waiting",
   * which is what draws the spinner; a key absent means nobody asked.
   */
  readonly details: Readonly<Record<string, SessionDetail | undefined>>;
  /**
   * The previews somebody asked for, keyed by `sessionKey` — P5a-T4.
   *
   * A second map beside `details` rather than a field on one, and the split is the same one core
   * makes on its side: a detail arrives with the expansion and a preview arrives only when it is
   * asked for, because asking spawns `claude logs` and waits 2.7 s for 330 KB (RESEARCH.md F.2.5).
   * A key present with `undefined` means "asked, still waiting"; a key absent means nobody asked,
   * which is the state every expanded row starts in and most of them stay in.
   */
  readonly previews: Readonly<Record<string, SessionPreview | undefined>>;
  /**
   * The imported projects, newest first — P3-T1.
   *
   * Empty is the honest starting state and stays empty until the owner imports something: the
   * registry ships empty and nothing scans the disk (DECISIONS.md D26). Fetched rather than
   * streamed, because only a person sitting here can change it.
   */
  readonly projects: readonly ProjectRecord[];
  /** Why the last import was refused, as core's code. `undefined` once one succeeds. */
  readonly importRefusal: ImportRefusal | undefined;
  /**
   * Stack and git per imported folder, keyed by `projectKey` — P3-T2.
   *
   * A second map rather than fields on the records, which is core's own split: a `ProjectRecord`
   * is a permission the owner granted and survives a restart, while this is a reading taken a
   * moment ago. A project with no entry here has not been read yet, and the row draws without it
   * rather than waiting — the panel's job is to list what was imported, and the branch is an
   * annotation on that.
   */
  readonly statuses: Readonly<Record<string, ProjectStatus>>;
  /**
   * What Claude is configured to do in each imported folder, keyed by `projectKey` — P3-T3.
   *
   * A third map beside `statuses` for the reason that one is beside `projects`: the three are read
   * on three routes with three costs and three lifetimes, and a row draws with whichever of them
   * has arrived. A project with no entry here has not been read yet; a project with an entry whose
   * `configured` is `false` has been read and has no `.claude`, and those are different rows.
   */
  readonly maps: Readonly<Record<string, WorkflowMap>>;
  /**
   * The last time each folder's configuration CHANGED, and what changed — P3-T7.
   *
   * Beside `maps` rather than inside one, because the two are different kinds of fact: a map is
   * what is configured now and is re-derived from the disk, a drift is what happened, at an
   * instant, and lives in core's store. A folder absent from here has never changed since it was
   * imported, which is the ordinary state and draws nothing.
   */
  readonly drifts: Readonly<Record<string, ConfigDrift>>;
  /**
   * What Claude actually did in each folder, keyed by `projectKey` — P3-T5.
   *
   * A fourth map beside `statuses` and `maps`, and the one with three states rather than two:
   * a key ABSENT means nobody pressed the button, a key present holding `undefined` means a 90 MB
   * read is in flight, and a key holding a reading is an answer. `previews` has the same shape for
   * the same reason — both are reads nobody should pay for until they ask.
   */
  readonly observed: Readonly<Record<string, ObservedBehaviour | undefined>>;
  /**
   * Every imported folder's launch presets, built-ins and saved together — P4-T1.
   *
   * A flat list rather than a map by `projectKey`, unlike the three above it, and the difference is
   * real: a status and a map are ONE reading per project, so a keyed record is the natural shape,
   * while presets are many per project and every one of them already carries the key it is filed
   * under. `PresetsViewModel` does the filtering, which keeps the key that selects them the same
   * key core filed them under.
   */
  readonly presets: readonly LaunchPreset[];
  /** Why the last save was refused, as core's code. `undefined` once one succeeds. */
  readonly presetRefusal: PresetRefusal | undefined;
  readonly coreUp: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
}

/**
 * One open connection to the stream, reduced to what the store uses.
 *
 * An interface rather than `EventSource` itself, for the same reason every port in core is one:
 * this file is unit-tested without a browser, and a DOM type here would also make it untypeable by
 * the Node TypeScript project the tests compile under (tsconfig.json vs tsconfig.app.json).
 */
export interface EventStreamSource {
  /** @param listener receives the frame's `data` text, unparsed. */
  on(type: string, listener: (data: string) => void): void;
  close(): void;
}

/** What the store needs from the browser: a connection, and a way to wait before retrying. */
export interface StreamTransport {
  open(url: string): EventStreamSource;
  /** @returns a cancel. Calling it after the task has run is a no-op. */
  wait(ms: number, task: () => void): () => void;
}

/** The state a deck starts in: nothing known, nothing connected, nothing wrong. */
export const EMPTY: DeckState = {
  rows: [],
  unreadable: [],
  quota: undefined,
  ask: undefined,
  askRefusal: undefined,
  health: {},
  update: undefined,
  respawn: undefined,
  details: {},
  previews: {},
  projects: [],
  importRefusal: undefined,
  statuses: {},
  maps: {},
  drifts: {},
  observed: {},
  presets: [],
  presetRefusal: undefined,
  coreUp: false,
  loading: false,
  error: undefined,
};

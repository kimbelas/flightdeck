'use client';

// The deck. Rows on the left, panes on the right — P2-T4's shape at P5a-T3's fidelity.
//
// Composition and state only: every piece of rendering lives in a child, and every derivation
// lives in SessionRowViewModel. What is left here is the two things that are genuinely this
// component's — which panes are open, and what time it is for the "started 4m ago" column. The
// PTY credential is not among them any more: each pane mints its own ticket when it connects
// (DECISIONS.md D32), so there is nothing page-wide to hold.
//
// The rows arrive on their own since P1-T9: the store subscribes to core's stream, so nothing here
// fetches, polls or re-renders on a timer to stay current.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react';
import { duplicateCwdKeys } from '../../contracts/duplicate-cwd.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import { BrowserDeckApi } from './browser-deck-api.ts';
import { BrowserStreamTransport } from './browser-stream-transport.ts';
import { CommandPalette } from './command-palette.tsx';
import { DeckBody } from './deck-body.tsx';
import { installActions } from './deck-install.tsx';
import { askActions, lifecycleActions, projectActions } from './deck-actions.ts';
import { DeckTop, projectTargets } from './deck-top.tsx';
import { groupTargets } from './group-targets.ts';
import { DeckStore } from './deck-store.ts';
import { deckCommands, type DeckActions } from './deck-commands.ts';
import { SessionRowViewModel } from './session-row-view-model.ts';
import { ShortcutSheet } from './shortcut-sheet.tsx';
import { ProjectScope } from './project-scope.ts';
import { useCurrentProject } from './use-current-project.ts';
import { usePaneGrid, type PaneGridState } from './use-pane-grid.ts';
import type { OpenPane } from './open-pane.ts';
import { nextShellPane } from './shell-pane.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { useDeckKeys, type DeckKeys } from './use-deck-keys.ts';

const AGE_TICK_MS = 10_000;

/** What a shell with no project is called, on the button and in the pane's title. */
const HOME = 'home';

export function DeckView(): JSX.Element {
  const store = useDeckStore();
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useLiveStream(store);
  // P3-T6. Which project a session is in, from the registry and the worktrees the maps carry.
  // Rebuilt per render on purpose: it is a derivation over two lists the store already holds,
  // and memoising it would be a cache to keep in step with both of them.
  const scope = new ProjectScope(state.projects, state.maps);
  const project = useCurrentProject((key) => scope.has(key));
  // The grid needs the rows to know which stored panes are still attachable after a reload
  // (P5a-T5b), `coreUp` to know when that list is worth reading, and the project to know which
  // stored layout is in force (P3-T6).
  const grid = usePaneGrid(state.rows, state.coreUp, project.key);
  const { expanded, toggle } = useExpandedRows(store);
  const now = useTickingClock();
  // Which subscription's installation panel is open, or `undefined` — P4-T5. Component state
  // rather than store state: nothing outside this page cares, and the reading it triggers is in
  // the store where it belongs.
  const [install, setInstall] = useState<SubscriptionId | undefined>(undefined);
  const actions = useDeckActions(store, usePaneActions(store, grid, state.projects, project.key), setInstall); // prettier-ignore

  // Every session, unfiltered: the palette can reach one the `/` box is currently hiding — and,
  // since P3-T6, one the current project is hiding too. Narrowing happens in `DeckBody`.
  // P6-T5. Computed once over the whole list and handed to every row: "is another account live in
  // this folder" is a property of the SET, and forty rows answering it separately would be forty
  // passes over the same list.
  const shared = duplicateCwdKeys(state.rows);
  const rows = state.rows.map((row) => new SessionRowViewModel(row, shared));
  // `onLayout` comes from the grid rather than from `useDeckActions`: the palette's six layout
  // entries and the chooser's six buttons must be the same call, or one of them gets the next fix.
  const targets = { rows, ...actions, onLayout: grid.setLayout, onChooseProject: project.choose };
  // `groupTargets` is derived from the presets already on screen — a group is every preset wearing
  // its name (P6-T4), so there is nothing to fetch and nothing that can go stale on its own.
  const palette = { ...targets, projects: projectTargets(state, scope), groups: groupTargets(state.presets) }; // prettier-ignore
  const keys = useDeckKeys(deckCommands(palette), { onMovePane: grid.movePaneBy });

  return (
    <main className="deck">
      <DeckTop
        state={state}
        now={now}
        count={rows.length}
        install={install !== undefined}
        actions={actions}
      />
      <DeckBody
        rows={rows}
        state={state}
        now={now}
        grid={grid}
        scope={scope}
        project={project}
        expanded={expanded}
        actions={actions}
        onToggle={toggle}
      />
      <DeckOverlays keys={keys} />
    </main>
  );
}

/**
 * The palette and the shortcut sheet — the two things the keyboard puts on top of the deck.
 *
 * Both are absent rather than hidden when closed. The palette autofocuses its input, and an input
 * that exists behind `display: none` is an input that can hold focus while looking closed.
 */
function DeckOverlays({ keys }: { readonly keys: DeckKeys }): JSX.Element | null {
  const { palette } = keys;
  if (palette !== undefined) {
    return (
      <CommandPalette
        palette={palette}
        query={keys.paletteQuery}
        onQuery={keys.onPaletteQuery}
        onSelect={keys.onPaletteSelect}
        onRun={keys.onPaletteRun}
        onClose={keys.onClosePalette}
      />
    );
  }
  if (keys.sheetOpen) {
    return <ShortcutSheet keymap={keys.keymap} api={SHEET_API} onClose={keys.onCloseSheet} />;
  }
  return null;
}

/**
 * The sheet's own client, module-level because it is stateless and the sheet is not always mounted.
 *
 * Not the store's: nothing the helper does belongs in a session snapshot, and threading the store
 * through the sheet to reach the `fetch` inside it would make every keyboard question a deck-state
 * question (P5a-T7).
 */
const SHEET_API = new BrowserDeckApi();

/**
 * One store for the life of the page, with the browser's two adapters in it.
 *
 * A hook so the composition is named rather than inlined, and `useMemo` rather than `useState`
 * because a second store would be a second stream: the identity is the point, not the caching.
 */
function useDeckStore(): DeckStore {
  return useMemo(() => new DeckStore(new BrowserStreamTransport(), new BrowserDeckApi()), []);
}

/**
 * The stream, open for as long as the deck is mounted — P1-T9.
 *
 * The cleanup is not a formality: without it StrictMode's second mount in development leaves the
 * first connection open, and core would hold a subscription and a heartbeat for a page that no
 * longer exists. `connect` and `disconnect` are both idempotent for the same reason.
 */
function useLiveStream(store: DeckStore): void {
  useEffect(() => {
    store.connect();
    // The registry, once — it is not on the stream, because only somebody on this page can move it
    // (P3-T1). Every later change re-reads it from the write that caused it.
    void store.loadProjects();
    return () => {
      store.disconnect();
    };
  }, [store]);
}

/**
 * Opening a shell in the CURRENT project — P6-T1, SPEC §5.7(3).
 *
 * A hook rather than a line in `useDeckActions`, because it needs the GRID: the id has to be
 * one no open pane is using, and `useDeckActions` knows about the store and not about what is
 * on screen. It is also the join P3-T6 made possible — a shell opened while looking at a
 * repository is a shell IN that repository, which is the whole of "or the goal fails at the
 * first `git status`".
 *
 * The folder's NAME goes in the title, not its key: the key is lowercased with its separators
 * folded, and `shell-1 · c:/users/.../app-next` is not a title.
 */
function usePaneActions(
  store: DeckStore,
  grid: PaneGridState,
  projects: readonly ProjectRecord[],
  current: string | undefined,
): PaneOpeners {
  const label =
    current === undefined
      ? HOME
      : (projects.find((project) => projectKey(project.path) === current)?.name ?? HOME);
  const { panes, openPane, closePane } = grid;
  const onOpenShell = useCallback(() => {
    openPane(nextShellPane(panes, current, label));
  }, [panes, openPane, current, label]);

  // P6-T2. The card is closed on CORE's answer, not on the press: `detached: true` is core
  // saying it released the hold. Leaving it would show "evicted", which is the right word
  // for somebody ELSE taking the attach (F.2.6) and the wrong one for a button you pressed.
  const onPopOut = useCallback(
    (row: SessionRowViewModel) => {
      void store.popOut(row.ref, row.title, row.cwd).then((opened) => {
        if (opened) closePane(row.key);
      });
    },
    [store, closePane],
  );
  return { openPane, onOpenShell, onPopOut };
}

/** What the deck does that needs the GRID. One object, because `max-params` is four. */
interface PaneOpeners {
  readonly openPane: (pane: OpenPane) => void;
  readonly onOpenShell: () => void;
  readonly onPopOut: (row: SessionRowViewModel) => void;
}

/**
 * What the buttons do, as stable references — and since P2-T5, what the palette's entries do too.
 *
 * Together rather than inline for two reasons. Stable identities keep `SessionList` from
 * re-rendering every row on every tick of the clock. And this component's job is composition
 * (CODING-STANDARDS §3): four arrow functions in JSX are four pieces of behaviour hidden inside
 * markup, and one of them — the empty-name rule below — is a decision rather than plumbing.
 *
 * `DeckActions` is declared in deck-commands.ts because the palette needs the same four: a command
 * that opened a pane its own way would be a second implementation of the row's button.
 */
function useDeckActions(
  store: DeckStore,
  panes: PaneOpeners,
  openInstall: (subscription: SubscriptionId | undefined) => void,
): DeckActions {
  const { openPane, onOpenShell, onPopOut } = panes;

  const onOpenPane = useCallback(
    (row: SessionRowViewModel) => {
      openPane({ key: row.key, title: row.title, target: row.target });
    },
    [openPane],
  );

  // One function for the form and for a preset, as of P4-T2 — both send the same four fields now
  // that the profile function is the routing (`DeckActions.onLaunch`).
  const onLaunch = useCallback(
    (request: PresetLaunch) => {
      void store.launch(request);
    },
    [store],
  );

  const onRefresh = useCallback(() => {
    void store.refresh();
  }, [store]);

  return {
    onOpenShell,
    onPopOut,
    onOpenPane,
    onLaunch,
    onRefresh,
    ...lifecycleActions(store),
    ...projectActions(store),
    ...askActions(store),
    ...installActions(store, openInstall),
  };
}

interface ExpandedRows {
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (row: SessionRowViewModel) => void;
}

/**
 * Which rows are open, and the fetch that opening one starts — P2-T4.
 *
 * The set lives here and the details live in the store, which sounds split but is not: "is this row
 * open" is a fact about this browser tab, and the detail is data off the wire. Keeping the set in
 * the store would make a second tab's expansion arrive as a re-render here.
 *
 * Collapsing calls `forget`, so re-expanding re-reads. See `DeckStore.expand` — `state.json` and
 * `timeline.jsonl` move while a row is open, and a detail from four minutes ago that looks current
 * is worse than a spinner.
 */
function useExpandedRows(store: DeckStore): ExpandedRows {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(
    (row: SessionRowViewModel) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.delete(row.key)) {
          store.forget(row.key);
          return next;
        }
        next.add(row.key);
        void store.expand(row.ref);
        return next;
      });
    },
    [store],
  );

  return { expanded, toggle };
}

/**
 * Only so "started 4m ago" and the header's quota countdowns do not freeze.
 *
 * It reads no data and asks core for nothing — it is a clock, not a poll, which is the distinction
 * P1-T9 drew. One clock for both because two would drift against each other on the same screen, and
 * 10 s is fine for a countdown printed to the minute.
 */
function useTickingClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, AGE_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

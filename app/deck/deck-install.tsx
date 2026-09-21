'use client';

// The version chip's panel, wired — split out of `deck-view.tsx` in P4-T5.
//
// That file has a 250-line limit and reached it again, and of what it does this is the piece with
// a story of its own: a panel whose contents cost a process per subscription to fetch, so nothing
// is read until the chip is pressed.
//
// **`onOpenInstall` both opens the panel and takes the reading.** A panel that opened empty and
// needed a second click to say anything is a panel nobody presses twice. Everything else here is a
// button inside it — including `update`, which is deliberately NOT run on open: there is no
// check-only form of that verb, so opening a panel must not be able to change the binary
// (RESEARCH.md F.10.2).
import type { JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';
import { BrowserDeckApi } from './browser-deck-api.ts';
import { ConnectPanel } from './connect-panel.tsx';
import type { DeckActions } from './deck-commands.ts';
import type { DeckState } from './deck-state.ts';
import type { DeckStore } from './deck-store.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import { InstallPanel } from './install-panel.tsx';

/**
 * The Connect panel's own client, module-level for `SHEET_API`'s reason (deck-view.tsx): it is
 * stateless, the panel is not always mounted, and nothing it does belongs in a session snapshot.
 */
const CONNECT_API = new BrowserDeckApi();

/** The installation panel, wired. */
export function DeckInstall({
  state,
  actions,
}: {
  readonly state: DeckState;
  readonly actions: DeckActions;
}): JSX.Element {
  return (
    <InstallPanel
      health={state.health}
      update={state.update}
      respawn={state.respawn}
      onCheck={actions.onCheckInstall}
      onUpdate={actions.onUpdateClaude}
      onRespawnAll={actions.onRespawnAll}
      onClose={actions.onCloseInstall}
    >
      <ConnectPanel api={CONNECT_API} />
    </InstallPanel>
  );
}

/** The five verbs the panel needs. See the header for why opening also reads. */
export function installActions(
  store: DeckStore,
  openInstall: (subscription: SubscriptionId | undefined) => void,
): Pick<
  DeckActions,
  | 'onOpenInstall'
  | 'onCheckInstall'
  | 'onUpdateClaude'
  | 'onRespawnAll'
  | 'onRespawnOne'
  | 'onCloseInstall'
> {
  return {
    onOpenInstall: (subscription: SubscriptionId) => {
      openInstall(subscription);
      void store.install.check(subscription);
    },
    onCheckInstall: (subscription: SubscriptionId) => {
      void store.install.check(subscription);
    },
    onUpdateClaude: (subscription: SubscriptionId) => {
      void store.install.update(subscription);
    },
    onRespawnAll: (subscription: SubscriptionId) => {
      void store.install.respawnAll(subscription);
    },
    // P5a-T6. The same slice as the panel's `--all`, because it is the same verb with one name
    // in it — and the reply is read the same way, from the ids the CLI printed (F.10.4).
    onRespawnOne: (row: SessionRowViewModel) => {
      void store.install.respawnOne(row.ref);
    },
    onCloseInstall: () => {
      openInstall(undefined);
    },
  };
}

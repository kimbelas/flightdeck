'use client';

// A board card, opened — P10-T1. The owner's ask: a pressed card should be big enough to READ what
// the session is showing, and a 200px column is not (a `claude logs` screen is 200 columns wide,
// RESEARCH.md G.34). So on the board an open card is a modal over the page, with the screen large
// and the rest of the card's detail beside it.
//
// **A background session you can reach is attached, live, and typed into here** — the owner's
// second ask. The terminal is the session's own PANE, opened on press as `open pane` would open it
// (so an attach held elsewhere is evicted, F.2.6, exactly as that button does), and pinned over
// this modal's stage by a class and `position: fixed` (`PaneView.enlarged`). It is never rendered
// in here: a terminal moved into another container is a remount, and a remount kills the PTY
// (`pane-grid.tsx`). Closing the modal leaves the pane in the dock.
//
// **Anything else reads its screen when it opens** — an interactive session cannot be attached at
// all (SPEC §5.2). Everywhere else a preview is a button (P5a-T4), because each read is a 2.7 s
// `claude logs`; here the press on the card IS the ask, so it reads once per opening, never on a
// timer, and `read again` is still the refresh.
//
// Closing is the card's own toggle: the modal is the card's expanded state drawn somewhere wider,
// not a second piece of state that could disagree with it. `Esc` closes it too (`dismiss`).
import { useEffect, useRef, type JSX, type MouseEvent, type RefObject } from 'react';
import { focusRow } from './deck-keyboard.ts';
import { RowHandoff } from './row-handoff.tsx';
import { SessionDetailView } from './session-detail-view.tsx';
import { SessionPreviewView } from './session-preview-view.tsx';
import { handlersFor, offerFor, refusalFor, type SessionListProps } from './session-list.tsx';
import { RowAction, RowDelete, RowTags } from './session-row-card.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface CardModalProps {
  readonly row: SessionRowViewModel;
  readonly list: SessionListProps;
}

export function CardModal({ row, list }: CardModalProps): JSX.Element {
  const on = handlersFor(row, list);
  const close = closer(row.key, on.onToggle);
  useOnOpen(row.canOpenPane ? on.onOpen : row.key in list.previews ? undefined : on.onPreview);
  const closeButton = useFocusOnOpen(!row.canOpenPane);
  return (
    <div className="scrim card-scrim" role="presentation" onMouseDown={onScrim(close)}>
      <section
        className={`card-modal tone-${row.tone}`}
        role="dialog"
        aria-modal="true"
        aria-label={row.title}
        data-card-modal={row.key}
      >
        <header className="card-modal-head">
          <span className="row-title">{row.title}</span>
          <RowTags row={row} inPane={list.paneOf(row.key)} />
          <span className="card-modal-meta muted">
            {row.project} · {row.stateLabel} · {row.startedAgo(list.now)}
          </span>
          <button
            ref={closeButton}
            type="button"
            className="ghost card-modal-close"
            data-card-modal-close
            aria-label={`close ${row.title}`}
            onClick={close}
          >
            ✕
          </button>
        </header>
        <CardModalBody row={row} list={list} onClose={close} />
      </section>
    </div>
  );
}

/** The screen, large, and beside it what the card already knew. */
function CardModalBody({
  row,
  list,
  onClose,
}: CardModalProps & { readonly onClose: () => void }): JSX.Element {
  const on = handlersFor(row, list);
  return (
    <div className="card-modal-body">
      <div className="card-modal-screen">
        {row.canOpenPane ? (
          <LiveStage row={row} list={list} />
        ) : (
          <SessionPreviewView
            preview={list.previews[row.key]}
            asked={row.key in list.previews}
            now={list.now}
            onPreview={on.onPreview}
          />
        )}
      </div>
      <aside className="card-modal-side">
        {/* A live pane carries its own stop, pop-out and respawn in its head. */}
        {!row.canOpenPane && <ModalActions row={row} list={list} onClose={onClose} />}
        <SessionDetailView detail={list.details[row.key]} now={list.now} />
        <RowHandoff
          offer={offerFor(list, row.key)}
          title={row.title}
          refusal={refusalFor(list.handoffRefusal, row.key)}
          onHandOff={on.onHandOff}
        />
        <RowDelete row={row} onRemove={on.onRemove} />
      </aside>
    </div>
  );
}

/**
 * The card's one lifecycle verb. Opening a pane closes the modal: the pane is in the dock under
 * it, and that is what the press was for.
 */
function ModalActions({
  row,
  list,
  onClose,
}: CardModalProps & { readonly onClose: () => void }): JSX.Element {
  const on = handlersFor(row, list);
  return (
    <RowAction
      row={row}
      onOpen={() => {
        on.onOpen();
        onClose();
      }}
      onResume={on.onResume}
      onAdopt={on.onAdopt}
      onStop={on.onStop}
    />
  );
}

/** Closing collapses the card, and puts the caret back on it so j/k carry on from there. */
function closer(key: string, toggle: () => void): () => void {
  return () => {
    toggle();
    requestAnimationFrame(() => {
      focusRow(key);
    });
  };
}

/**
 * Where the live pane is drawn: this box's place on screen, published for the stylesheet.
 *
 * As custom properties on the root, set through the CSSOM — the policy refuses a `style` attribute
 * (SEC-UI-1), not a property set from script — and cleared when the modal goes. Re-measured
 * whenever the box moves, so a window resize carries the pane with it, and its terminal refits
 * through its own ResizeObserver. What is UNDER the pane is only seen when there is no pane: the
 * attach is under way, or somebody closed it from its head.
 */
function LiveStage({ row, list }: CardModalProps): JSX.Element {
  const stage = useStageRect();
  const attached = list.paneOf(row.key) !== undefined;
  useFocusTerminal(attached);
  return (
    <div ref={stage} className="card-modal-stage" data-card-stage>
      {attached ? (
        <p className="muted pad">Attaching…</p>
      ) : (
        <p className="muted pad">
          The pane was closed.{' '}
          <button type="button" onClick={handlersFor(row, list).onOpen}>
            open pane
          </button>
        </p>
      )}
    </div>
  );
}

const STAGE_PROPERTIES = ['left', 'top', 'width', 'height'] as const;

function useStageRect(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (box === null) return undefined;
    const root = document.documentElement.style;
    const publish = (): void => {
      const rect = box.getBoundingClientRect();
      for (const side of STAGE_PROPERTIES)
        root.setProperty(`--card-stage-${side}`, `${String(rect[side])}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(box);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      for (const side of STAGE_PROPERTIES) root.removeProperty(`--card-stage-${side}`);
    };
  }, []);
  return ref;
}

/** The caret goes into the live terminal once it is there, so typing starts at once. */
function useFocusTerminal(attached: boolean): void {
  useEffect(() => {
    if (!attached) return undefined;
    let frame = requestAnimationFrame(function find() {
      const input = document.querySelector<HTMLElement>(
        '.pane-card.is-modal .xterm-helper-textarea',
      );
      if (input === null) {
        frame = requestAnimationFrame(find);
        return;
      }
      input.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [attached]);
}

/** What opening does, once: attach, or read the screen, or nothing when a read is already held. */
function useOnOpen(action: (() => void) | undefined): void {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current?.();
  }, []);
}

/** The close button holds the caret on open, so `Esc` reaches the deck's `dismiss` from inside. */
function useFocusOnOpen(enabled: boolean): RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    if (enabledRef.current) ref.current?.focus();
  }, []);
  return ref;
}

/** A press on the dimmed page outside the card closes it; a press inside the card does not. */
function onScrim(close: () => void): (event: MouseEvent) => void {
  return (event) => {
    if (event.target === event.currentTarget) close();
  };
}

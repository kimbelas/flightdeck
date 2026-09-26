'use client';

// A board card, opened — P10-T1. The owner's ask: a pressed card should be big enough to READ what
// the session is showing, and a 200px column is not (a `claude logs` screen is 200 columns wide,
// RESEARCH.md G.34). So on the board an open card is a modal over the page, with the screen large
// and the rest of the card's detail beside it.
//
// **It reads the screen when it opens.** Everywhere else a preview is a button (P5a-T4), because
// each read is a 2.7 s `claude logs`; here the press on the card IS the ask — nobody opens this to
// look at anything else — and it reads once per opening, never on a timer. `read again` is still
// the refresh, as it is in the list.
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
  useReadOnOpen(row.key in list.previews, on.onPreview);
  const closeButton = useFocusOnOpen();
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
        <SessionPreviewView
          preview={list.previews[row.key]}
          asked={row.key in list.previews}
          now={list.now}
          onPreview={on.onPreview}
        />
      </div>
      <aside className="card-modal-side">
        <ModalActions row={row} list={list} onClose={onClose} />
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

/** One read per opening, and none when a read for this card is already held or in flight. */
function useReadOnOpen(asked: boolean, read: () => void): void {
  const askedRef = useRef(asked);
  const readRef = useRef(read);
  useEffect(() => {
    if (!askedRef.current) readRef.current();
  }, []);
}

/** The close button holds the caret on open, so `Esc` reaches the deck's `dismiss` from inside. */
function useFocusOnOpen(): RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** A press on the dimmed page outside the card closes it; a press inside the card does not. */
function onScrim(close: () => void): (event: MouseEvent) => void {
  return (event) => {
    if (event.target === event.currentTarget) close();
  };
}

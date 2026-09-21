'use client';

// Handing a session to another worktree, from the row it is on — P6-T6, SPEC §6(8).
//
// **Its own file rather than a third function in `session-row-card.tsx`**, which is at its 250-line
// limit and has been split for it once already. The seam is real: every other control on that card
// is one press with nothing to fill in, and this one is a small form.
//
// **The disclosure is not a confirmation.** `RowDelete` next to it arms a second button because
// what it does cannot be undone; this cannot lose anything at all — the original keeps its id, its
// name and its conversation, and the fork is a second row. The button opens the form because the
// press needs two answers (which tree, what name), and for no other reason. There is no armed
// state and no warning sentence, and adding one would teach the hand that both look the same.
//
// **What comes back is one boolean, and it only decides whether the form closes.** Why a refusal
// happened is state and lives in the store keyed by row (`HandoffSlice`); whether this form is
// still open is a fact about this tab and this moment, which is `RowDelete`'s own argument for
// keeping its armed flag out of `DeckState`.
//
// The new session is NOT drawn from the reply. It arrives on the stream a sweep later like every
// other row, so a form that closed and then reported "started fd-x" would be claiming a row core
// has not yet said exists.
import { useState, type JSX } from 'react';
import {
  MAX_HANDOFF_NAME_CHARS,
  type HandoffOffer,
  type HandoffTarget,
} from './handoff-view-model.ts';

interface RowHandoffProps {
  readonly offer: HandoffOffer;
  /** The session's name, for the label a screen reader reads on the group. */
  readonly title: string;
  /** Why the last press on THIS row was refused, already in English. `undefined` for silence. */
  readonly refusal: string | undefined;
  readonly onHandOff: (path: string, name: string) => Promise<boolean>;
}

/** What the form is holding. One object so the two fields are one `useState`. */
interface HandoffDraft {
  readonly path: string;
  readonly name: string;
}

export function RowHandoff({ offer, title, refusal, onHandOff }: RowHandoffProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HandoffDraft>({ path: '', name: '' });

  // The reason takes the control's place rather than disabling it — the habit `blockedReason`
  // set on this card. A disabled button invites a second click and explains nothing.
  if (offer.nothingBecause !== undefined) {
    return <p className="row-handoff-none muted">{offer.nothingBecause}</p>;
  }
  if (!open) {
    return (
      <RowHandoffButton
        onOpen={() => {
          // Filled in HERE rather than from a `useState` initialiser or an effect: the offer
          // changes under this component when the map is re-read, and a default captured at
          // first render would then name a tree that is no longer on the list.
          setDraft({ path: offer.targets[0]?.path ?? '', name: offer.suggestedName });
          setOpen(true);
        }}
      />
    );
  }
  return (
    <RowHandoffForm
      targets={offer.targets}
      title={title}
      refusal={refusal}
      draft={draft}
      onDraft={setDraft}
      onClose={() => {
        setOpen(false);
      }}
      onHandOff={onHandOff}
    />
  );
}

/** The closed state: one press that asks the two questions, and says what it will not do. */
function RowHandoffButton({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  return (
    <div className="row-handoff">
      <button
        type="button"
        className="ghost"
        data-row-handoff
        title="Fork this conversation into another worktree. This session is untouched."
        onClick={onOpen}
      >
        hand off…
      </button>
    </div>
  );
}

interface RowHandoffFormProps {
  readonly targets: readonly HandoffTarget[];
  readonly title: string;
  readonly refusal: string | undefined;
  readonly draft: HandoffDraft;
  readonly onDraft: (draft: HandoffDraft) => void;
  /** Called on cancel and on a fork core made. A refused press leaves the form up. */
  readonly onClose: () => void;
  readonly onHandOff: (path: string, name: string) => Promise<boolean>;
}

/**
 * The two answers and the button that spends them.
 *
 * A `<form>` rather than a div of controls, because Enter in the name box should press it: this is
 * a two-field question, and the keyboard's answer to one is Enter. The name field is `required`,
 * so the browser's own refusal catches an empty one before a round trip does.
 */
function RowHandoffForm(props: RowHandoffFormProps): JSX.Element {
  const { targets, title, refusal, draft, onDraft, onClose } = props;
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="row-handoff is-open"
      aria-label={`hand off ${title}`}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void props.onHandOff(draft.path, draft.name).then((made) => {
          setBusy(false);
          if (made) onClose();
        });
      }}
    >
      <HandoffFields targets={targets} draft={draft} onDraft={onDraft} />
      <button type="submit" data-row-handoff-go disabled={busy}>
        {busy ? 'handing off…' : 'hand off'}
      </button>
      <button type="button" className="ghost" onClick={onClose}>
        cancel
      </button>
      {refusal !== undefined && (
        <p className="row-handoff-bad" data-row-handoff-bad>
          {refusal}
        </p>
      )}
    </form>
  );
}

/**
 * Which tree, and what to call it.
 *
 * Each control is wrapped in its own `<label>`, so neither needs an id to be named — a row is drawn
 * once per session and ids minted per row would have to be unique across forty of them.
 */
function HandoffFields({
  targets,
  draft,
  onDraft,
}: Pick<RowHandoffFormProps, 'targets' | 'draft' | 'onDraft'>): JSX.Element {
  return (
    <>
      <label className="row-handoff-field">
        into
        <select
          data-row-handoff-target
          value={draft.path}
          onChange={(event) => {
            onDraft({ ...draft, path: event.target.value });
          }}
        >
          {targets.map((target) => (
            <option key={target.path} value={target.path}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row-handoff-field">
        named
        <input
          data-row-handoff-name
          required
          maxLength={MAX_HANDOFF_NAME_CHARS}
          value={draft.name}
          onChange={(event) => {
            onDraft({ ...draft, name: event.target.value });
          }}
        />
      </label>
    </>
  );
}

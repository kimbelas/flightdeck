'use client';

// One session row. Renders a view model and nothing else — CODING-STANDARDS §3.
//
// The `open pane` button is absent rather than disabled when a session cannot be attached, and the
// reason takes its place. A disabled button invites a second click and explains nothing; the
// constraint here is permanent (SPEC §5.2) and worth a sentence.
//
// **The row expands in place rather than opening a panel** (P2-T4). The detail is about this
// session and belongs against it: a side panel would cost the row's context and force a choice
// about what happens when a second row is expanded. Several can be open at once, and the store
// keys details per row for that reason.
import { useState, type JSX } from 'react';
import type { HandoffOffer } from './handoff-view-model.ts';
import { RowHandoff } from './row-handoff.tsx';
import { SessionDetailView } from './session-detail-view.tsx';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';
import type { SessionPreviewViewModel } from './session-preview-view-model.ts';
import { SessionPreviewView } from './session-preview-view.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

export interface SessionRowCardProps {
  readonly row: SessionRowViewModel;
  readonly now: number;
  readonly expanded: boolean;
  /** `undefined` while the detail is in flight, which is what draws the row's spinner. */
  readonly detail: SessionDetailViewModel | undefined;
  /** The preview, if one was asked for and has arrived — P5a-T4. */
  readonly preview: SessionPreviewViewModel | undefined;
  /** Whether a preview was ASKED for at all, which is what tells "waiting" from "never pressed". */
  readonly previewAsked: boolean;
  /** Where this session could be handed to, and why not when it could not — P6-T6. */
  readonly handoff: HandoffOffer;
  /** Why the last handoff pressed on THIS row was refused, in English. `undefined` for silence. */
  readonly handoffRefusal: string | undefined;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onResume: () => void;
  readonly onAdopt: () => void;
  readonly onStop: () => void;
  readonly onRemove: () => void;
  readonly onPreview: () => void;
  readonly onHandOff: (path: string, name: string) => Promise<boolean>;
}

export function SessionRowCard(props: SessionRowCardProps): JSX.Element {
  const { row, now, expanded } = props;
  return (
    <article className={`row tone-${row.tone}${expanded ? ' row-open' : ''}`}>
      <div className="row-main">
        <RowToggle
          rowKey={row.key}
          title={row.title}
          expanded={expanded}
          onToggle={props.onToggle}
        />
        <span className="tag">{row.subscriptionLabel}</span>
        <span className="tag">{row.kindLabel}</span>
        {/*
          P6-T5, SPEC §5.6. On the collapsed row rather than inside the expansion, because the
          whole point is that nobody is looking for it: `claude agents` reads one config directory,
          so neither account's listing mentions the other's session in the folder. A warning you
          have to open a row to find is one this never reaches.
        */}
        {row.sharesWorkingTree && (
          <span className="tag tag-warn" data-row-shared-tree title={row.sharedTreeWarning}>
            shared folder
          </span>
        )}
      </div>
      <div className="row-meta">
        <span>{row.project}</span>
        <span>{row.stateLabel}</span>
        <span>{row.startedAgo(now)}</span>
      </div>
      <RowAction
        row={row}
        onOpen={props.onOpen}
        onResume={props.onResume}
        onAdopt={props.onAdopt}
        onStop={props.onStop}
      />
      {expanded && <RowOpen {...props} />}
    </article>
  );
}

/**
 * What an open row shows under its title: the detail, the preview, the handoff and the delete.
 *
 * The preview is offered on EVERY expanded row: a session that cannot be attached is the one this
 * matters most for, and a session that can is still one somebody may want to look at without
 * taking the terminal (P5a-T4). The delete control is last — see `RowDelete`.
 *
 * The handoff sits between them on purpose (P6-T6). It belongs below the preview, because which
 * tree to hand a session to is a decision somebody makes after looking at what it is doing; and it
 * belongs above the delete, because `RowDelete` is the last thing on this card and stays the last
 * thing on this card — a destructive control that moves is one that gets pressed by habit.
 */
function RowOpen({
  row,
  now,
  detail,
  preview,
  previewAsked,
  handoff,
  handoffRefusal,
  onRemove,
  onPreview,
  onHandOff,
}: Omit<
  SessionRowCardProps,
  'expanded' | 'onToggle' | 'onOpen' | 'onResume' | 'onAdopt' | 'onStop'
>): JSX.Element {
  return (
    <>
      <SessionDetailView detail={detail} now={now} />
      <SessionPreviewView preview={preview} asked={previewAsked} now={now} onPreview={onPreview} />
      <RowHandoff
        offer={handoff}
        title={row.title}
        refusal={handoffRefusal}
        onHandOff={onHandOff}
      />
      <RowDelete row={row} onRemove={onRemove} />
    </>
  );
}

interface RowDeleteProps {
  readonly row: SessionRowViewModel;
  readonly onRemove: () => void;
}

/**
 * The one control that destroys something — P4-T2.
 *
 * **It is not in `RowAction`, and that is the whole design.** `rm` deletes `jobs/<shortId>/` and
 * the conversation with it, with no resume afterwards (RESEARCH.md F.2.8), and the roadmap task
 * says in as many words that it must not arrive behind a button that looks like `stop`. So it is
 * three deliberate acts away from a collapsed row: expand it, press `delete…`, then press a button
 * that names the session. None of the three is where a hand lands by habit, and `stop` never moves.
 *
 * **Armed state lives here rather than in the store.** "I am about to delete this" is a fact about
 * this browser tab and this moment; putting it in `DeckState` would make it survive a re-render
 * from an unrelated stream frame, which is the one thing it must not do.
 */
function RowDelete({ row, onRemove }: RowDeleteProps): JSX.Element | undefined {
  const [armed, setArmed] = useState(false);
  if (!row.canRemove) return undefined;
  if (!armed) {
    return (
      <div className="row-delete">
        <button
          type="button"
          className="ghost danger"
          onClick={() => {
            setArmed(true);
          }}
        >
          delete…
        </button>
      </div>
    );
  }
  return (
    <RowDeleteArmed
      row={row}
      onRemove={onRemove}
      onCancel={() => {
        setArmed(false);
      }}
    />
  );
}

interface RowDeleteArmedProps extends RowDeleteProps {
  readonly onCancel: () => void;
}

/**
 * The second act: the sentence, and the button that names the session.
 *
 * The warning takes the whole width so the two buttons sit UNDER it — the one that deletes cannot
 * be pressed without the sentence having been on screen above it. It names the session because
 * "delete" alone is a word that can be pressed on the wrong row.
 */
function RowDeleteArmed({ row, onRemove, onCancel }: RowDeleteArmedProps): JSX.Element {
  return (
    <div className="row-delete is-armed" role="group" aria-label={`delete ${row.title}`}>
      <p className="row-delete-warning">{row.removeWarning}</p>
      <button
        type="button"
        className="danger"
        onClick={() => {
          onCancel();
          onRemove();
        }}
      >
        {`delete ${row.title}`}
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        cancel
      </button>
    </div>
  );
}

interface RowActionProps {
  readonly row: SessionRowViewModel;
  readonly onOpen: () => void;
  readonly onResume: () => void;
  readonly onAdopt: () => void;
  readonly onStop: () => void;
}

/**
 * What this row lets you do, which is at most one thing — P4-T2a, P6-T7.
 *
 * A live background session offers a pane; a stopped one offers `resume`; an ENDED interactive one
 * offers `adopt`; a live interactive one offers neither and says why, permanently (SPEC §5.2). The
 * sentence stays under the button rather than being replaced by it: it is the explanation P2 put
 * there on purpose, and it is what makes the button make sense — "Not running. Resume it to
 * attach." and "That terminal has closed." are each half of their own control.
 */
function RowAction({ row, onOpen, onResume, onAdopt, onStop }: RowActionProps): JSX.Element {
  if (!row.canOpenPane) return <RowBlocked row={row} onResume={onResume} onAdopt={onAdopt} />;
  return (
    <div className="row-actions">
      <button type="button" onClick={onOpen}>
        open pane
      </button>
      {/* No confirmation, deliberately: stopping keeps the session and its transcript, and
          resume wakes it again under its own id. `rm` is the verb that deletes and is not
          here — it needs a confirm of its own (RESEARCH.md F.2.8). */}
      {row.canStop && (
        <button type="button" className="ghost" onClick={onStop}>
          stop
        </button>
      )}
    </div>
  );
}

/**
 * A row no pane can open on: the reason, and the one button that might change that.
 *
 * At most one button, and `canResume` and `canAdopt` cannot both be true — they are complements
 * across `kind` (`SessionRowViewModel`). A live interactive session has neither and keeps only the
 * sentence, which is SPEC §5.2's permanent constraint rather than a gap.
 */
function RowBlocked({
  row,
  onResume,
  onAdopt,
}: Omit<RowActionProps, 'onOpen' | 'onStop'>): JSX.Element {
  return (
    <div className="row-blocked-line">
      <p className="row-blocked">{row.blockedReason}</p>
      {row.canResume && (
        <button type="button" className="ghost" onClick={onResume}>
          resume
        </button>
      )}
      {/* P6-T7, SPEC §4.3's migration path. The title carries what the label cannot: an adopted
          session is renamed after its own short id, because `-n` would keep the name and `-n`
          starts a copy (G.55). */}
      {row.canAdopt && (
        <button
          type="button"
          className="ghost"
          data-row-adopt
          title={row.adoptHint}
          onClick={onAdopt}
        >
          adopt
        </button>
      )}
    </div>
  );
}

interface RowToggleProps {
  /** `data-deck-row`, which is how `j`/`k` and the palette's "jump to" find this button. */
  readonly rowKey: string;
  readonly title: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/**
 * The title line, which IS the expand control rather than having one beside it.
 *
 * The row is dense, and a 4 mm chevron next to a 30 mm title is the wrong thing to have to aim at.
 * `aria-expanded` is on the button rather than the article because the button is what a screen
 * reader announces as the control.
 *
 * It is also where `j`/`k` put focus (P2-T5), which is why the keyboard needed no selection state
 * of its own: this was already a focusable control that does the row's one thing on Enter.
 */
function RowToggle({ rowKey, title, expanded, onToggle }: RowToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className="row-toggle"
      data-deck-row={rowKey}
      aria-expanded={expanded}
      onClick={onToggle}
      title={expanded ? 'Collapse' : 'Show what this session is doing'}
    >
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <span className="row-title">{title}</span>
    </button>
  );
}

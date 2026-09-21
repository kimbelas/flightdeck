'use client';

// A pane's title bar and the controls that act on the session behind it — P5a-T6, SPEC §5.3.
//
// Out of `pane-view.tsx` because that file owns a lifecycle — a socket, a terminal, a disposal
// order — and this owns none of it. Nothing here touches the PTY: `stop` and `respawn` are core
// verbs about the SESSION, and the pane finds out what they did the same way it finds out about
// anything else, by watching its socket.
//
// **The list SPEC §5.3 gives is not the list that ships, and each absence was measured.**
//
//   - **resume** is on the session ROW (P4-T2a), because a stopped session has no pane to put a
//     button on. Nothing is missing here; the control is where the state is.
//   - **interrupt** is Ctrl+C, which already reaches the PTY through xterm — `BROWSER_OWNED` claims
//     only Ctrl+W/T/N — so a button would be a second way to do a thing that works.
//   - **mute** belongs to the toasts it would silence, which are P6-T3. A mute with nothing to
//     mute is a switch that does nothing.
//   - **pop out to Windows Terminal** is P6-T2, which has the AppX path resolution in it.
//   - **rename** is this pane's label and NOT the session's. Claude Code has no rename: `-n/--name`
//     is start-only and `respawn` takes no name, measured on 2.1.278 against every background verb.
//     So the pane says what it renames rather than pretending, which is the Ctrl+W precedent from
//     P5a-T7 — half a control, labelled as half.
import { useCallback, useState, type JSX } from 'react';
import { ENDED_STATUSES, type PaneStatus } from '../panes/pane-status.ts';

/** What the session behind this pane can be asked to do. Absent for a shell — it has no session. */
export interface PaneControls {
  /** A running background session. The row's `canStop`, so the two cannot disagree. */
  readonly canStop: boolean;
  /**
   * Any background session, running or not.
   *
   * Wider than `canStop` on purpose: `respawn --all` skips a session that has finished, and
   * respawning that same session BY NAME works (RESEARCH.md F.10.4). The pane names one.
   */
  readonly canRespawn: boolean;
  readonly onStop: () => void;
  readonly onRespawn: () => void;
}

export interface PaneHeadProps {
  readonly title: string;
  readonly status: PaneStatus;
  readonly controls: PaneControls | undefined;
  readonly onRename: (title: string) => void;
  readonly onReattach: () => void;
  readonly onClose: () => void;
}

export function PaneHead(props: PaneHeadProps): JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const stopRenaming = useCallback(() => {
    setRenaming(false);
  }, []);

  return (
    <header className="pane-head">
      {renaming ? (
        <RenameBox title={props.title} onRename={props.onRename} onDone={stopRenaming} />
      ) : (
        <PaneTitle
          title={props.title}
          status={props.status}
          onRename={() => {
            setRenaming(true);
          }}
        />
      )}
      <SessionVerbs controls={props.controls} />
      {/* Offered for every ending, not only eviction: a pane whose session was resumed elsewhere
          and a pane whose socket dropped are both reattachable, and neither is worth a reload. A
          respawn ends in exactly this state, which is why it is not followed by an auto-reattach —
          the pane says what happened and the button is one click. */}
      {ENDED_STATUSES.has(props.status) && (
        <button type="button" className="ghost" onClick={props.onReattach}>
          reattach
        </button>
      )}
      <button type="button" className="ghost" onClick={props.onClose}>
        close
      </button>
    </header>
  );
}

function PaneTitle({
  title,
  status,
  onRename,
}: {
  readonly title: string;
  readonly status: PaneStatus;
  readonly onRename: () => void;
}): JSX.Element {
  return (
    <>
      <span className="pane-title">{title}</span>
      <span className={`chip chip-${status}`}>{status}</span>
      <button type="button" className="ghost" data-pane-rename onClick={onRename}>
        rename
      </button>
    </>
  );
}

/**
 * The two verbs that act on the session — P4-T2b's `stop` and P4-T5's `respawn`, on a pane.
 *
 * Neither is confirmed. `stop` keeps the conversation and `attach` opens it again, and `respawn`
 * restarts a session that is already meant to be running — the destructive verb is `rm`, which has
 * its armed second button on the ROW (P4-T2) and is deliberately not here: a delete one click from
 * a terminal somebody is typing in is the wrong place for it.
 */
function SessionVerbs({ controls }: { readonly controls: PaneControls | undefined }): JSX.Element {
  if (controls === undefined) return <></>;
  return (
    <>
      {controls.canStop && (
        <button type="button" className="ghost" data-pane-stop onClick={controls.onStop}>
          stop
        </button>
      )}
      {controls.canRespawn && (
        <button type="button" className="ghost" data-pane-respawn onClick={controls.onRespawn}>
          respawn
        </button>
      )}
    </>
  );
}

/** Said every time the box is open, because the word is wider than what this actually does. */
function RenameNote(): JSX.Element {
  return (
    <span className="muted pane-rename-note">
      Names this pane only. Claude Code has no rename — the session keeps its own name.
    </span>
  );
}

/**
 * The rename editor.
 *
 * It says what it renames, every time, because the honest answer is narrower than the word: this
 * is the pane's label in this browser, and the session keeps whatever `--name` it was started
 * with. Blank reverts — a pane with no title is one nobody can name to a digit.
 */
function RenameBox({
  title,
  onRename,
  onDone,
}: {
  readonly title: string;
  readonly onRename: (title: string) => void;
  readonly onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(title);
  return (
    <form
      className="pane-rename"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(draft.trim());
        onDone();
      }}
    >
      <input
        // Autofocus is the point: this box exists only because somebody pressed `rename`, so the
        // focus move is the one they asked for rather than one the page took.
        autoFocus
        aria-label="pane name"
        data-pane-rename-input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        // Escape only. Every other deck shortcut is already off in here: focus in an input is the
        // `text` key context, where nothing but Ctrl+K and Esc is bound (contracts/keymap.ts), so
        // `1`-`9` and `[`/`]` type rather than move panes. Stopping propagation would buy nothing
        // and cost Ctrl+K — the window listener is in the CAPTURE phase and has already run.
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <button type="submit" className="ghost" data-pane-rename-save>
        name it
      </button>
      <RenameNote />
    </form>
  );
}

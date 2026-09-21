'use client';

// One terminal pane. Mounts a TerminalPane, opens a PaneSocket, and gets out of the way.
//
// The effect runs once per target: a pane that respawned because a parent re-rendered would kill
// and restart a real Claude session, which is why PaneSocket and TerminalPane are classes the
// effect *owns* rather than state React reconciles.
//
// **xterm's own stylesheet is imported here, and it is not optional** (P5a-T6a). Without it the
// pane still renders, which is exactly what made it ship: xterm falls back to static positioning,
// and the `.xterm-char-measure-element` it fills with 32 `>` glyphs to measure a cell paints at the
// top of every pane instead of being parked off-screen. That is the "garbage line" of RESEARCH.md
// G.5, misread there as an escape sequence xterm could not parse — it parses that sequence fine
// (G.29). The import belongs next to the component that mounts a terminal rather than in
// `layout.tsx`, so a deck with no pane open does not pay for it.
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import { ImagePaste } from '../panes/image-paste.ts';
import { PaneSocket } from '../panes/pane-socket.ts';
import type { PaneStatus } from '../panes/pane-status.ts';
import { TerminalPane } from '../panes/terminal-pane.ts';
import { PaneHead, type PaneControls } from './pane-head.tsx';

interface PaneViewProps {
  /** Position from the left, zero-based. What `1`-`9` resolves against — see `data-deck-pane`. */
  readonly index: number;
  readonly target: PtyTarget;
  readonly title: string;
  readonly focused: boolean;
  /** What the session behind this pane can be asked to do — P5a-T6. A shell has no session. */
  readonly controls: PaneControls | undefined;
  readonly onFocused: () => void;
  /** Renames the PANE, in this browser. See `pane-head.tsx` for why that is the whole verb. */
  readonly onRename: (title: string) => void;
  readonly onClose: () => void;
}

type Report = (status: PaneStatus, detail: string | undefined) => void;
/** A line about something the pane did on its own — today, an image paste (P5a-T8). */
type Note = (note: string | undefined) => void;

/**
 * How many terminals this page has built, ever. Stamped on each card as `data-pane-mount`.
 *
 * It exists for one assertion and it is worth the two lines: reordering panes must be a React key
 * move and never a remount, because a remount disposes the terminal and closes the socket — which
 * for an attached session means killing a live PTY because somebody pressed an arrow key. A counter
 * OUTSIDE React is the only honest detector, since any state inside the component is reset by the
 * remount it is supposed to notice (`data-pane-attempt` was, and the first version of the check
 * passed against a build that remounted on every move).
 */
let mounts = 0;

/**
 * Builds the pane and its socket, and returns the teardown.
 *
 * Separate from the component so the lifecycle is readable in one piece: open, connect, focus —
 * and on the way out, close the socket before disposing the terminal, so the last thing the socket
 * does cannot be a write into a disposed one.
 */
function mountPane(
  host: HTMLElement,
  target: PtyTarget,
  report: Report,
  note: Note,
): { readonly socket: PaneSocket; readonly dispose: () => void } {
  const pane = new TerminalPane();
  pane.open(host);
  const socket = new PaneSocket(pane, { onStatus: report });
  // Mints a ticket before it opens the socket (D32), so this no longer completes synchronously.
  // The teardown below is still returned immediately, and `PaneSocket.close` covers the gap.
  void socket.connect(target);
  pane.focus();

  // P5a-T8. Attached to the HOST rather than to the terminal, because it has to see the event
  // before xterm's textarea does — see `ImagePaste`. `socket.paste` and not a write to the
  // terminal: the path is input, and input goes over the bound socket (SEC-WS-3).
  const detachPaste = new ImagePaste({
    onPath: (path) => {
      socket.paste(path);
    },
    onNote: note,
  }).attach(host);

  // The PTY only learns the real size from us, so a window resize has to reach it.
  const onResize = (): void => {
    socket.resize();
  };
  window.addEventListener('resize', onResize);

  return {
    socket,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      detachPaste();
      // Closing a pane detaches; it never stops the session (RESEARCH.md F.2.6).
      socket.close();
      pane.dispose();
    },
  };
}

export function PaneView({
  index,
  target,
  title,
  focused,
  controls,
  onFocused,
  onRename,
  onClose,
}: PaneViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { status, detail, note, attempt, mount, reattach, stopping } = usePaneLifecycle(
    target,
    hostRef,
  );

  return (
    // `data-deck-pane` is what `1`-`9` resolves against (P2-T5), and it CARRIES the position rather
    // than relying on document order, because focus mode reorders the grid. On the card rather than
    // on the host so the digit finds the pane even before xterm has attached its input to it.
    //
    // `onFocus` is React's delegated `focusin`, so it fires for xterm's hidden textarea inside —
    // clicking into a pane and pressing its digit both mark it focused, and `[`/`]` move that one.
    <section
      className={focused ? 'pane-card is-focused' : 'pane-card'}
      data-deck-pane={index}
      data-pane-attempt={attempt}
      data-pane-mount={mount}
      onFocus={onFocused}
      aria-label={`terminal for ${title}`}
    >
      <PaneHead
        title={title}
        status={status}
        controls={announceStop(controls, stopping)}
        onRename={onRename}
        onReattach={reattach}
        onClose={onClose}
      />
      <PaneLines detail={detail} note={note} />
      <div ref={hostRef} className="pane-host" />
      <footer className="pane-foot">
        Closing this pane detaches it. The session keeps running.
      </footer>
    </section>
  );
}

/**
 * The status line and the pane's own note, which are two lines and not one.
 *
 * `detail` belongs to the status — "evicted", and why — and `note` is something the pane did on
 * its own, today an image paste (P5a-T8). A paste must not overwrite `evicted`.
 */
function PaneLines({
  detail,
  note,
}: {
  readonly detail: string | undefined;
  readonly note: string | undefined;
}): JSX.Element {
  return (
    <>
      {detail !== undefined && <p className="pane-detail">{detail}</p>}
      {note !== undefined && (
        <p className="pane-note" data-pane-note>
          {note}
        </p>
      )}
    </>
  );
}

/**
 * The same controls, with `stop` telling this pane's socket what is about to happen — P5a-T6.
 *
 * Here rather than in `PaneGrid`, which builds the controls: the grid knows about sessions and
 * rows, and the socket belongs to this component's effect. What the wrapper buys is the difference
 * between "another terminal attached to this session" and "you stopped this session", which is a
 * sentence the pane can only get right by remembering which button was pressed (`pane-status.ts`).
 */
function announceStop(
  controls: PaneControls | undefined,
  stopping: () => void,
): PaneControls | undefined {
  if (controls === undefined) return undefined;
  return {
    ...controls,
    onStop: () => {
      stopping();
      controls.onStop();
    },
  };
}

interface PaneLifecycle {
  readonly status: PaneStatus;
  readonly detail: string | undefined;
  /** Kept apart from `detail`, which belongs to the status: a paste must not overwrite `evicted`. */
  readonly note: string | undefined;
  readonly attempt: number;
  /** Which terminal this is, page-wide. Changes only when one was actually built — see `mounts`. */
  readonly mount: number;
  readonly reattach: () => void;
  /** Tells the socket the next exit is one this pane asked for. Sends nothing — see `stopping`. */
  readonly stopping: () => void;
}

/**
 * The pane's socket, its status, and the one button that starts it over.
 *
 * `reattach` bumps a counter that is in the effect's deps, so a second attempt is a genuine
 * teardown and remount — the same path a freshly opened pane takes. A reconnect written as its own
 * branch would be a second lifecycle to keep correct, and the first one already has the eviction,
 * the ticket and the disposal order in it.
 */
function usePaneLifecycle(
  target: PtyTarget,
  hostRef: RefObject<HTMLDivElement | null>,
): PaneLifecycle {
  const [status, setStatus] = useState<PaneStatus>('connecting');
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [mount, setMount] = useState(0);
  // The live socket, so `stop` can reach it. A ref rather than state: it changes on remount and
  // nothing renders from it, and putting it in state would remount the pane it belongs to.
  const socketRef = useRef<PaneSocket | undefined>(undefined);

  const stopping = useCallback(() => {
    socketRef.current?.stopping();
  }, []);

  const reattach = useCallback(() => {
    setStatus('connecting');
    setDetail(undefined);
    setNote(undefined);
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    mounts += 1;
    setMount(mounts);
    const mounted = mountPane(
      host,
      target,
      (next, why) => {
        setStatus(next);
        setDetail(why);
      },
      setNote,
    );
    socketRef.current = mounted.socket;
    return mounted.dispose;
    // `attempt` is the remount trigger and is deliberately not read in the body.
  }, [target, attempt, hostRef]);

  return { status, detail, note, attempt, mount, reattach, stopping };
}

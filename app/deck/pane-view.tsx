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
import { PaneSocket } from '../panes/pane-socket.ts';
import { ENDED_STATUSES, type PaneStatus } from '../panes/pane-status.ts';
import { TerminalPane } from '../panes/terminal-pane.ts';

interface PaneViewProps {
  readonly target: PtyTarget;
  readonly title: string;
  readonly onClose: () => void;
}

type Report = (status: PaneStatus, detail: string | undefined) => void;

/**
 * Builds the pane and its socket, and returns the teardown.
 *
 * Separate from the component so the lifecycle is readable in one piece: open, connect, focus —
 * and on the way out, close the socket before disposing the terminal, because disposing first
 * leaves the WebGL addon holding a context Chromium still counts.
 */
function mountPane(host: HTMLElement, target: PtyTarget, report: Report): () => void {
  const pane = new TerminalPane(0);
  pane.open(host);
  const socket = new PaneSocket(pane, { onStatus: report });
  // Mints a ticket before it opens the socket (D32), so this no longer completes synchronously.
  // The teardown below is still returned immediately, and `PaneSocket.close` covers the gap.
  void socket.connect(target);
  pane.focus();

  // The PTY only learns the real size from us, so a window resize has to reach it.
  const onResize = (): void => {
    socket.resize();
  };
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    // Closing a pane detaches; it never stops the session (RESEARCH.md F.2.6).
    socket.close();
    pane.dispose();
  };
}

export function PaneView({ target, title, onClose }: PaneViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { status, detail, attempt, reattach } = usePaneLifecycle(target, hostRef);

  return (
    // `data-deck-pane` is what `1`-`9` counts (P2-T5). On the card rather than on the host so
    // the digit finds the pane even before xterm has attached its input to it.
    <section
      className="pane-card"
      data-deck-pane=""
      data-pane-attempt={attempt}
      aria-label={`terminal for ${title}`}
    >
      <header className="pane-head">
        <span className="pane-title">{title}</span>
        <span className={`chip chip-${status}`}>{status}</span>
        {/* Offered for every ending, not only eviction: a pane whose session was resumed elsewhere
            and a pane whose socket dropped are both reattachable, and neither is worth a reload. */}
        {ENDED_STATUSES.has(status) && (
          <button type="button" className="ghost" onClick={reattach}>
            reattach
          </button>
        )}
        <button type="button" className="ghost" onClick={onClose}>
          close
        </button>
      </header>
      {detail !== undefined && <p className="pane-detail">{detail}</p>}
      <div ref={hostRef} className="pane-host" />
      <footer className="pane-foot">
        Closing this pane detaches it. The session keeps running.
      </footer>
    </section>
  );
}

interface PaneLifecycle {
  readonly status: PaneStatus;
  readonly detail: string | undefined;
  readonly attempt: number;
  readonly reattach: () => void;
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
  const [attempt, setAttempt] = useState(0);

  const reattach = useCallback(() => {
    setStatus('connecting');
    setDetail(undefined);
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    return mountPane(host, target, (next, why) => {
      setStatus(next);
      setDetail(why);
    });
    // `attempt` is the remount trigger and is deliberately not read in the body.
  }, [target, attempt, hostRef]);

  return { status, detail, attempt, reattach };
}

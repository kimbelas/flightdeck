'use client';

// One terminal pane. Mounts a TerminalPane, opens a PaneSocket, and gets out of the way.
//
// The effect runs once per target: a pane that respawned because a parent re-rendered would kill
// and restart a real Claude session, which is why PaneSocket and TerminalPane are classes the
// effect *owns* rather than state React reconciles.
import { useEffect, useRef, useState, type JSX } from 'react';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import { PaneSocket, type PaneStatus } from '../panes/pane-socket.ts';
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
  const [status, setStatus] = useState<PaneStatus>('connecting');
  const [detail, setDetail] = useState<string | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    return mountPane(host, target, (next, why) => {
      setStatus(next);
      setDetail(why);
    });
  }, [target]);

  return (
    <section className="pane-card" aria-label={`terminal for ${title}`}>
      <header className="pane-head">
        <span className="pane-title">{title}</span>
        <span className={`chip chip-${status}`}>{status}</span>
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

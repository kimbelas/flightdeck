'use client';

// P0-T6 harness — the client half of the route.
//
// The component holds no logic beyond mounting: PaneGrid owns the terminals, and the probe drives
// it through `window.fdSpike` rather than by clicking. That is deliberate — the measurements this
// page exists for (how many WebGL contexts Chromium hands out, what happens to the oldest when it
// stops) are not things a user gesture can express, and a button per case would be a UI nobody
// ever uses again.
import { useEffect, useRef, useState, type JSX } from 'react';
import '@xterm/xterm/css/xterm.css';
import { PaneGrid, type GridReport } from './pane-grid.ts';
import { installSpikeApi } from './spike-api.ts';

export function XtermHarness(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [report, setReport] = useState<GridReport | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    const grid = new PaneGrid(container);
    const uninstall = installSpikeApi(grid, setReport);
    return () => {
      uninstall();
      grid.disposeAll();
    };
  }, []);

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 14, margin: '0 0 4px' }}>P0-T6 — xterm.js 6 harness</h1>
      <p style={{ color: 'var(--dim)', margin: '0 0 12px' }} data-testid="summary">
        {report === null
          ? 'idle — the probe drives this page through window.fdSpike'
          : `${String(report.panes.length)} panes · ${String(report.webgl)} webgl · ` +
            `${String(report.dom)} dom · ${String(report.lost)} lost · peak webgl ${String(report.peakWebgl)}`}
      </p>
      <div
        ref={containerRef}
        data-testid="panes"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}
      />
    </main>
  );
}

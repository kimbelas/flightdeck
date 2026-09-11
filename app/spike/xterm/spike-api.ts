// P0-T6 — the handle the probe drives the page by.
//
// A spike affordance, and scoped like one: it exists only on this route, it is removed when the
// component unmounts, and nothing outside `scripts/xterm-spike-cli.ts` calls it. The deck proper
// (P2) exposes nothing on `window` — a global that can mount terminals would be exactly the thing
// SEC-UI-2 exists to prevent, so this must not outlive the spike route.
import type { GridReport } from './pane-grid.ts';
import type { PaneGrid } from './pane-grid.ts';

export interface SpikeApi {
  readonly addPanes: (count: number) => GridReport;
  readonly report: () => GridReport;
  readonly writeTo: (index: number, data: string) => Promise<void>;
  readonly textOf: (index: number) => string;
  readonly blockedOf: (index: number) => readonly string[];
  readonly fitAll: () => Promise<GridReport>;
  /** Resolves after two animation frames — long enough for layout and for context-loss events. */
  readonly settle: () => Promise<GridReport>;
  readonly setColumns: (columns: number) => void;
  readonly loseContext: (index: number) => boolean;
  readonly disposeAll: () => void;
}

declare global {
  var fdSpike: SpikeApi | undefined;
}

/** One animation frame, which is the smallest wait that guarantees layout has been applied. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** Asks the driver to drop a pane's WebGL context, the way Chromium would under pressure. */
function loseContextOf(container: HTMLElement, index: number): boolean {
  const host = container.querySelector(`[data-pane="${String(index)}"]`);
  if (host === null) return false;
  // A pane holds three canvases — xterm-link-layer (2D), the WebGL one, and the texture atlas
  // (2D) — so taking the first is taking the wrong one. `getContext` returns null on a canvas
  // that already has a context of another kind, which makes scanning safe.
  for (const canvas of host.querySelectorAll('canvas')) {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) continue;
    const extension = gl.getExtension('WEBGL_lose_context');
    if (extension === null) continue;
    extension.loseContext();
    return true;
  }
  return false;
}

/** Installs the handle and returns the function that removes it again. */
export function installSpikeApi(
  grid: PaneGrid,
  onReport: (report: GridReport) => void,
): () => void {
  const container = grid.host;
  const publish = (report: GridReport): GridReport => {
    onReport(report);
    return report;
  };

  globalThis.fdSpike = {
    addPanes: (count) => publish(grid.addMany(count)),
    report: () => publish(grid.report()),
    writeTo: async (index, data) => {
      await grid.paneAt(index)?.write(data);
    },
    textOf: (index) => grid.paneAt(index)?.visibleText() ?? '',
    blockedOf: (index) => grid.paneAt(index)?.blocked ?? [],
    fitAll: async () => {
      // A grid-template change is not applied until the next layout, so fitting in the same
      // task measures the OLD width and every pane reports the geometry it already had.
      await nextFrame();
      grid.fitAll();
      return publish(grid.report());
    },
    settle: async () => {
      await nextFrame();
      await nextFrame();
      return publish(grid.report());
    },
    setColumns: (columns) => {
      container.style.gridTemplateColumns = `repeat(${String(columns)}, 1fr)`;
    },
    loseContext: (index) => loseContextOf(container, index),
    disposeAll: () => {
      grid.disposeAll();
      publish(grid.report());
    },
  };

  return () => {
    globalThis.fdSpike = undefined;
  };
}

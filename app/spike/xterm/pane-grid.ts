// P0-T6 — many panes in one page, which is the only way to find where Chromium stops giving out
// WebGL contexts.
//
// The grid owns the host elements as well as the panes. React never touches a terminal's DOM:
// xterm writes into that node itself, and a re-render that replaced it would take the renderer
// with it. The component hands over one container and then leaves the grid alone.
import { TerminalPane, type PaneReport } from '../../panes/terminal-pane.ts';

export interface GridReport {
  readonly panes: readonly PaneReport[];
  readonly webgl: number;
  readonly dom: number;
  readonly lost: number;
  /** The highest number of WebGL panes ever alive at once — the cap this machine allows. */
  readonly peakWebgl: number;
}

export class PaneGrid {
  private readonly container: HTMLElement;
  private readonly panes: TerminalPane[] = [];
  private peak = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public get size(): number {
    return this.panes.length;
  }

  /** The element the panes live in — the probe needs it to find a pane's canvas. */
  public get host(): HTMLElement {
    return this.container;
  }

  /** Adds one pane, opens it, and returns which renderer it actually got. */
  public add(): PaneReport {
    const host = document.createElement('div');
    host.className = 'pane';
    host.dataset['pane'] = String(this.panes.length);
    this.container.appendChild(host);

    const pane = new TerminalPane(this.panes.length);
    this.panes.push(pane);
    pane.open(host);
    // P0-T6 measures Chromium's WebGL context budget, so every pane here must ask for one. The
    // deck does not: it takes a context only for the focused pane (TerminalPane.enableWebgl).
    pane.enableWebgl();
    void pane.write(`pane ${String(this.panes.length - 1)} ready\r\n`);
    this.remember();
    return pane.report();
  }

  public addMany(count: number): GridReport {
    for (let index = 0; index < count; index += 1) this.add();
    return this.report();
  }

  public paneAt(index: number): TerminalPane | undefined {
    return this.panes[index];
  }

  public report(): GridReport {
    // Recounted on every call rather than tracked incrementally: a context is lost asynchronously,
    // by the browser, with no call into this class, so any counter we maintained would be stale.
    this.remember();
    const panes = this.panes.map((pane) => pane.report());
    return {
      panes,
      webgl: panes.filter((pane) => pane.renderer === 'webgl').length,
      dom: panes.filter((pane) => pane.renderer === 'dom').length,
      lost: panes.filter((pane) => pane.contextLost).length,
      peakWebgl: this.peak,
    };
  }

  public fitAll(): void {
    for (const pane of this.panes) pane.fit();
  }

  public disposeAll(): void {
    for (const pane of this.panes) pane.dispose();
    this.panes.length = 0;
    this.container.replaceChildren();
    this.peak = 0;
  }

  private remember(): void {
    const live = this.panes.filter((pane) => pane.renderer === 'webgl').length;
    if (live > this.peak) this.peak = live;
  }
}

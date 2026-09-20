// One xterm.js pane — promoted out of the P0-T6 spike for P5a-T3, and DOM-rendered since P5a-T3b.
//
// There is no renderer decision here any more, and that is D40 rather than an omission. A pane used
// to carry three extra states — which renderer it holds, whether its GL context was lost, and the
// focus-driven enable/release that rationed contexts between panes — all of it to stay under a
// per-page WebGL cap that P0-T6 measured at 40 headless and 76 on this GPU, against a nine-pane
// layout. Nothing was ever close to the cap, and the addon that would have spent it paints nothing
// unless `@xterm/xterm/css/xterm.css` is on the page (RESEARCH.md G.30). Rationing a resource that
// is not scarce cost the class a third of its surface and cost five phases a wrong diagnosis.
//
// What the DOM renderer buys, beyond one less state machine: the pane's text lands in the DOM, so
// `innerText` of `.pane-host` is both what a test reads and what a person sees. On WebGL those two
// come apart — `.xterm-rows` empties out — and every assertion the smoke makes about painted text
// would have to be a pixel comparison to stay honest.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

/** Keys the page must never see, because the browser keeps them (RESEARCH.md E.2). */
const BROWSER_OWNED = new Set(['w', 't', 'n']);

/** One terminal and its fit addon. */
export class TerminalPane {
  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;

  constructor() {
    this.terminal = new Terminal({
      cols: 80,
      rows: 24,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      allowProposedApi: true,
      convertEol: true,
    });
    this.fitAddon = new FitAddon();
  }

  /** Mounts the terminal on xterm's DOM renderer, which is the only renderer this pane has. */
  public open(host: HTMLElement): void {
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(host);
    this.attachKeyHandler();
    this.fit();
  }

  /**
   * Everything typed into this pane, as the terminal saw it.
   *
   * Raw bytes, not key events: xterm has already turned Ctrl+C into  and an arrow key into
   * its escape sequence, and the PTY wants exactly that. Anything that re-encoded here would be
   * a second, worse terminal.
   */
  public onInput(listener: (data: string) => void): void {
    this.terminal.onData(listener);
  }

  /** The size the terminal settled on after `fit()`, for the resize frame the PTY needs. */
  public size(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  /** Focuses the pane, so the next keystroke goes here rather than to the page. */
  public focus(): void {
    this.terminal.focus();
  }

  /** Resolves when xterm has *parsed* the data, not when it was queued. */
  public write(data: string): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write(data, resolve);
    });
  }

  public fit(): void {
    this.fitAddon.fit();
  }

  public dispose(): void {
    this.terminal.dispose();
  }

  private attachKeyHandler(): void {
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (!event.ctrlKey || !BROWSER_OWNED.has(event.key.toLowerCase())) return true;
      // Belt and braces: the browser keeps these before the page sees them (RESEARCH.md E.2), so
      // this only matters on a shell that does deliver one — and then the shell, not the PTY,
      // should have it. The tally the spike used to read off `blocked` went with the spike; the
      // measured list is in E.2 and F.5.4, which is where P5a-T7 reads it from.
      event.preventDefault();
      return false;
    });
  }
}

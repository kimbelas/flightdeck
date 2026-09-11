// One xterm.js pane — promoted out of the P0-T6 spike for P5a-T3.
//
// The spike built this to measure Chromium's WebGL context budget; the deck uses the same class to
// render a real session. What P5a-T3 adds is the two-way half: `onInput` so keystrokes leave, and
// `size()` so a fit can be reported back to the PTY. Everything else is the spike's, unchanged.
//
// P0-T6's original header follows.
//
// P0-T6 — one xterm.js pane, and everything P5a-T3 will need to know about it.
//
// The pane owns its renderer decision rather than the component, because the decision is not a
// render-time one: Chromium evicts the *oldest* WebGL context when a page asks for too many
// (RESEARCH.md E.1), so a pane can lose its renderer long after it mounted, with no re-render to
// hang the fallback off. `onContextLoss` therefore disposes the addon and drops to the DOM
// renderer here, and the component just reads `renderer` afterwards.
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

export type RendererKind = 'webgl' | 'dom';

export interface PaneReport {
  readonly id: number;
  readonly renderer: RendererKind;
  readonly contextLost: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly bufferType: 'normal' | 'alternate';
}

/** Keys the page must never see, because the browser keeps them (RESEARCH.md E.2). */
const BROWSER_OWNED = new Set(['w', 't', 'n']);

/**
 * One terminal, its addons, and its own renderer state.
 *
 * Disposal is explicit and ordered — the WebGL addon before the terminal — because disposing the
 * terminal first leaves the addon holding a context Chromium still counts against the per-page cap.
 */
export class TerminalPane {
  private readonly id: number;
  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private webgl: WebglAddon | undefined;
  private rendererKind: RendererKind = 'dom';
  private lostContext = false;
  private readonly blockedKeys: string[] = [];

  constructor(id: number) {
    this.id = id;
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

  public get renderer(): RendererKind {
    return this.rendererKind;
  }

  public get lost(): boolean {
    return this.lostContext;
  }

  /** Keys the custom handler refused to pass to the terminal, newest last. */
  public get blocked(): readonly string[] {
    return this.blockedKeys;
  }

  /**
   * Mounts the terminal on the DOM renderer.
   *
   * **WebGL is not taken here**, and that is P5a-T3's "renderer budget" rather than a shortcut.
   * Chromium caps WebGL contexts per page and evicts the OLDEST when the cap is passed (RESEARCH.md
   * E.1), so nine panes each grabbing one at mount is how the pane you are typing in loses its
   * renderer to a pane you are not looking at. The DOM renderer also writes real text into the DOM,
   * which is the only thing a test — or a screen reader — can read.
   */
  public open(host: HTMLElement): void {
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(host);
    this.attachKeyHandler();
    this.fit();
  }

  /**
   * Upgrades this pane to the WebGL renderer.
   *
   * **The deck does not call this, and that is measured rather than cautious.** With
   * `@xterm/addon-webgl` 0.19.0 on `@xterm/xterm` 6.0.0 the addon activates, creates its canvases,
   * reports `renderer: 'webgl'` — and paints nothing at all. A pane attached to a real session
   * shows a cursor on an empty black rectangle while `onData` is delivering thousands of bytes of
   * correct output. Neither package declares a peer range, so npm cannot warn (RESEARCH.md G.4).
   *
   * It is kept, not deleted, because P0-T6's context-budget measurements run through it and
   * P5a-T3b has to decide the renderer properly. On the DOM renderer every pane paints, and the
   * text lands in the DOM where a test and a screen reader can both read it.
   *
   * Safe to call repeatedly and safe to call after a context loss: a pane already on WebGL, or one
   * that cannot have a context, stays as it is.
   */
  public enableWebgl(): void {
    if (this.webgl !== undefined || this.lostContext) return;
    this.tryWebgl();
  }

  /** Hands the WebGL context back, so a pane losing focus stops occupying one. */
  public releaseWebgl(): void {
    this.disposeWebgl();
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
    // Deliberately does NOT call enableWebgl() — see that method for what happens when it does.
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

  /** Text content of the active buffer, which is how the probe proves the DOM fallback renders. */
  public visibleText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }
    return lines.join('\n').trimEnd();
  }

  public report(): PaneReport {
    return {
      id: this.id,
      renderer: this.rendererKind,
      contextLost: this.lostContext,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      bufferType: this.terminal.buffer.active.type,
    };
  }

  public dispose(): void {
    this.disposeWebgl();
    this.terminal.dispose();
  }

  /**
   * Loads the WebGL renderer, and quietly stays on the DOM one if the context cannot be had.
   *
   * A failure here is normal, not exceptional: past Chromium's per-page cap the constructor
   * throws rather than returning, and a pane on the DOM renderer is a working pane.
   */
  private tryWebgl(): void {
    try {
      const addon = new WebglAddon();
      // Subscribed AFTER loadAddon: the addon's emitters are created in activate(), so a handler
      // registered against the unactivated instance is attached to nothing and never fires.
      this.terminal.loadAddon(addon);
      addon.onContextLoss(() => {
        this.lostContext = true;
        this.disposeWebgl();
      });
      this.webgl = addon;
      this.rendererKind = 'webgl';
    } catch {
      this.rendererKind = 'dom';
    }
  }

  private disposeWebgl(): void {
    this.webgl?.dispose();
    this.webgl = undefined;
    this.rendererKind = 'dom';
  }

  private attachKeyHandler(): void {
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (!event.ctrlKey || !BROWSER_OWNED.has(event.key.toLowerCase())) return true;
      // Recorded even though it changes nothing: the browser never delivers these, and P5a-T7
      // needs the measured list rather than the assumed one.
      this.blockedKeys.push(`ctrl+${event.key.toLowerCase()}`);
      event.preventDefault();
      return false;
    });
  }
}

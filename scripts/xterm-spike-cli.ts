// P0-T6 runner.
//
//   npm run build && node scripts/xterm-spike-cli.ts              (starts `next start` itself)
//   FD_UI=http://127.0.0.1:4949 node scripts/xterm-spike-cli.ts   (against one already running)
//
// Drives the /spike/xterm page in Chromium through `globalThis.fdSpike`. These measurements cannot
// be made any other way: how many WebGL contexts Chromium hands one page, and what happens to the
// oldest when it runs out, are properties of the browser rather than of xterm.js — so RESEARCH.md
// E.1's "~16 contexts, oldest evicted" stays a citation until something on this machine counts them.
//
// Every page call uses Playwright's **callback** form. The string form is `eval` inside the page,
// which the CSP refuses (correctly), and loosening the CSP to measure it would have measured a
// different application than the one being shipped.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const UI_ORIGIN = process.env['FD_UI'] ?? 'http://127.0.0.1:4949';
const PANE_STEP = 4;
/** The probe's own stop, not the browser's — raise it with FD_PANES when the browser outlasts it. */
const PANE_CEILING = Number(process.env['FD_PANES'] ?? '48');
/** Headless Chromium renders WebGL through SwiftShader, which has its own limits. */
const HEADED = process.env['FD_HEADED'] === '1';
/** Longer than the addon's own 3 s timer, with room for a slow machine. */
const LOSS_BUDGET_MS = 8_000;

const ALT_SCREEN = '\u001b[?1049h alt screen ';

interface PaneReport {
  readonly id: number;
  readonly renderer: 'webgl' | 'dom';
  readonly contextLost: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly bufferType: 'normal' | 'alternate';
}

interface LossResult {
  readonly asked: boolean;
  readonly report: GridReport;
  readonly elapsedMs: number;
}

interface GridReport {
  readonly panes: readonly PaneReport[];
  readonly webgl: number;
  readonly dom: number;
  readonly lost: number;
  readonly peakWebgl: number;
}

/**
 * The page's spike handle, declared structurally rather than imported from app/.
 *
 * Importing the real type would pull the DOM lib into this project, which tsconfig.app.json exists
 * to keep out; and the probe should fail loudly if the page drifts from what it expects.
 */
declare global {
  var fdSpike:
    | {
        addPanes(count: number): GridReport;
        report(): GridReport;
        writeTo(index: number, data: string): Promise<void>;
        textOf(index: number): string;
        fitAll(): Promise<GridReport>;
        settle(): Promise<GridReport>;
        disposeAll(): void;
        setColumns(columns: number): void;
        loseContext(index: number): boolean;
      }
    | undefined;
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(40)}${value}`);
}

/** Starts `next start` unless FD_UI already points at something, and waits for it to answer. */
class UiServer {
  private child: ChildProcess | undefined;

  private static async waitFor(url: string, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return;
      } catch {
        // Not up yet; the deadline is the only thing that ends this loop.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${url} did not answer within ${String(budgetMs)} ms`);
  }

  public async start(): Promise<void> {
    if (process.env['FD_UI'] !== undefined) return;
    // `npm.cmd` cannot be spawned directly on Node 26 (EINVAL — .cmd needs a shell, and
    // SEC-PROC-1 bans `shell: true`), so the Next binary is run by this interpreter instead.
    const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
    this.child = spawn(process.execPath, [nextBin, 'start', '-p', '4949'], { stdio: 'ignore' });
    await UiServer.waitFor(UI_ORIGIN, 90_000);
  }

  public stop(): void {
    this.child?.kill();
  }
}

/** Every measurement the task names, each read back through the page's own report. */
class XtermProbe {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Adds panes until the browser starts taking contexts away.
   *
   * Eviction is asynchronous and arrives as an event, so each batch is settled before it is
   * believed — reading the report in the same task as the mount shows every pane on WebGL and a
   * loss count of zero no matter how many are open.
   */
  public async findWebglCap(): Promise<GridReport> {
    let report = await this.addPanes();
    while (report.panes.length < PANE_CEILING) {
      await this.addPanes();
      const settled = await this.settle();
      const stopped = settled.lost > 0 || settled.dom > 0;
      report = settled;
      if (stopped) break;
    }
    return report;
  }

  /** Clears the grid and mounts a small one, so a test is not racing the browser's evictions. */
  public async restart(panes: number): Promise<GridReport> {
    await this.page.evaluate((count) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      globalThis.fdSpike.disposeAll();
      globalThis.fdSpike.addPanes(count);
    }, panes);
    return this.settle();
  }

  public settle(): Promise<GridReport> {
    return this.page.evaluate(() => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      return globalThis.fdSpike.settle();
    });
  }

  public async altScreen(): Promise<PaneReport | undefined> {
    const report = await this.page.evaluate(async (sequence) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      await globalThis.fdSpike.writeTo(0, sequence);
      return globalThis.fdSpike.report();
    }, ALT_SCREEN);
    return report.panes[0];
  }

  public async fitToColumns(columns: number): Promise<PaneReport | undefined> {
    const report = await this.page.evaluate(async (count) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      globalThis.fdSpike.setColumns(count);
      return await globalThis.fdSpike.fitAll();
    }, columns);
    return report.panes[0];
  }

  /**
   * Drops a pane's WebGL context and waits for the fallback, timing how long it takes.
   *
   * The wait is generous on purpose: @xterm/addon-webgl 0.19.0 fires `onContextLoss` from a
   * `setTimeout(..., 3000)` inside its own `webglcontextlost` listener, so a 500 ms wait reports
   * "still on webgl" and looks like the fallback is broken.
   */
  public async loseContext(index: number): Promise<LossResult> {
    const startedAt = Date.now();
    const asked = await this.page.evaluate((target) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      return globalThis.fdSpike.loseContext(target);
    }, index);

    let report = await this.settle();
    while (Date.now() - startedAt < LOSS_BUDGET_MS) {
      const pane = report.panes.find((candidate) => candidate.id === index);
      if (pane?.renderer === 'dom') break;
      await this.page.waitForTimeout(250);
      report = await this.settle();
    }
    return { asked, report, elapsedMs: Date.now() - startedAt };
  }

  public textOf(index: number): Promise<string> {
    return this.page.evaluate((target) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      return globalThis.fdSpike.textOf(target);
    }, index);
  }

  private addPanes(): Promise<GridReport> {
    return this.page.evaluate((step) => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      return globalThis.fdSpike.addPanes(step);
    }, PANE_STEP);
  }

  private report(): Promise<GridReport> {
    return this.page.evaluate(() => {
      if (globalThis.fdSpike === undefined) throw new Error('fdSpike missing');
      return globalThis.fdSpike.report();
    });
  }
}

/** How many WebGL contexts this browser gives one page, and which pane loses one first. */
async function reportContexts(probe: XtermProbe): Promise<GridReport> {
  console.log(
    `\nWebGL contexts per page (${HEADED ? 'headed, real GPU' : 'headless, SwiftShader'})\n`,
  );
  const capped = await probe.findWebglCap();
  row('panes mounted', String(capped.panes.length));
  row('peak WebGL contexts', String(capped.peakWebgl));
  row('on the DOM renderer', String(capped.dom));
  row('contexts lost while mounting', String(capped.lost));
  row('hit the probe ceiling instead', String(capped.panes.length >= PANE_CEILING));

  // RESEARCH.md E.1 says the OLDEST context is the one evicted. That is checkable: if it holds,
  // every pane that lost a context has a lower id than every pane that kept one.
  const evicted = capped.panes.filter((pane) => pane.contextLost).map((pane) => pane.id);
  const kept = capped.panes.filter((pane) => pane.renderer === 'webgl').map((pane) => pane.id);
  const oldestFirst =
    evicted.length > 0 && kept.length > 0 && Math.max(...evicted) < Math.min(...kept);
  row('evicted pane ids', evicted.length > 0 ? evicted.join(', ') : 'none');
  row('oldest evicted first', String(oldestFirst));
  return capped;
}

async function reportFit(probe: XtermProbe): Promise<void> {
  console.log('\nfit and resize\n');
  const wide = await probe.fitToColumns(1);
  const narrow = await probe.fitToColumns(6);
  row('cols at 1 pane per row', String(wide?.cols ?? 0));
  row('cols at 6 panes per row', String(narrow?.cols ?? 0));
  row('fit changed the geometry', String((wide?.cols ?? 0) !== (narrow?.cols ?? 0)));
}

async function reportAltScreen(probe: XtermProbe): Promise<void> {
  console.log('\nalt screen\n');
  const alt = await probe.altScreen();
  row('buffer type after ESC[?1049h', alt?.bufferType ?? 'unknown');
}

/**
 * The DOM fallback, on a fresh two-pane grid.
 *
 * Not on the grid from `reportContexts`: at the context cap the browser keeps evicting on its own
 * schedule, so a pane picked as "still on WebGL" can be gone before the driver is asked, and the
 * eviction path gets measured a second time instead of the explicit one.
 */
async function reportFallback(probe: XtermProbe): Promise<void> {
  console.log('\nonContextLoss fallback\n');
  const fresh = await probe.restart(2);
  const live = fresh.panes.find((pane) => pane.renderer === 'webgl')?.id ?? 0;
  const before = await probe.textOf(live);
  const { asked, report, elapsedMs } = await probe.loseContext(live);
  const after = await probe.textOf(live);
  const target = report.panes.find((pane) => pane.id === live);
  row('panes on the fresh grid', `${String(fresh.panes.length)} (${String(fresh.webgl)} webgl)`);
  row('pane chosen (still on webgl)', String(live));
  row('driver accepted loseContext()', String(asked));
  row('renderer after loss', target?.renderer ?? 'unknown');
  row('flagged contextLost', String(target?.contextLost ?? false));
  row('time to fall back', `${String(elapsedMs)} ms`);
  row('text survived the fallback', String(before !== '' && after.includes(before)));
}

async function measure(page: Page): Promise<void> {
  const probe = new XtermProbe(page);
  await reportContexts(probe);
  await reportFit(probe);
  await reportAltScreen(probe);
  await reportFallback(probe);
}

async function main(): Promise<number> {
  const server = new UiServer();
  let browser: Browser | undefined;
  try {
    await server.start();
    browser = await chromium.launch({ headless: !HEADED });
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on('pageerror', (error) => {
      failures.push(error.message);
      console.error(`  page error: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`  console: ${message.text()}`);
    });

    await page.goto(`${UI_ORIGIN}/spike/xterm`, { waitUntil: 'load' });
    // `load` fires before React hydrates and the handle is installed by an effect, so the wait is
    // for the handle itself rather than for a lifecycle event that merely correlates with it.
    await page.waitForFunction(() => globalThis.fdSpike !== undefined, undefined, {
      timeout: 20_000,
    });
    await measure(page);
    return failures.length === 0 ? 0 : 1;
  } finally {
    await browser?.close();
    server.stop();
  }
}

process.exitCode = await main();

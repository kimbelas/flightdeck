// P0-T5 runner.
//
//   node scripts/statusline-spike-cli.ts measure [--payload warm|fresh]
//   node scripts/statusline-spike-cli.ts transport      python import cost, the real bottleneck
//
// Nothing here touches ~/.claude/hooks/statusline.py or either config dir: the script is copied
// into a scratch directory, patched there, and both copies are run with LOCALAPPDATA and TEMP
// pointed at that directory, so the block reads a scratch token and the real one is never opened.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { StatuslinePatcher } from './statusline-patch.ts';
import {
  RenderProbe,
  StatuslineReceiver,
  type ReceiverMode,
  type RenderResult,
} from './statusline-spike.ts';

const execFileAsync = promisify(execFile);

const PORT = 4950;
const REPS = 3;
const COST_REPS = 11;
/** A statusline process serves one render, so the first call is sampled once per process. */
const COST_PROCESSES = 5;
const ATTEMPTS = 3;
const PYTHON = process.env['FD_PYTHON'] ?? 'python';
const STATUSLINE =
  process.env['FD_STATUSLINE'] ?? join(homedir(), '.claude', 'hooks', 'statusline.py');
const FIXTURES = fileURLToPath(new URL('../fixtures/statusline/', import.meta.url));
const BLOCK = fileURLToPath(new URL('./statusline-block.py', import.meta.url));
const COST_DRIVER = fileURLToPath(new URL('./statusline-cost.py', import.meta.url));

/** statusline.py's own imports, so the numbers below are marginal cost, not absolute. */
const BASE_IMPORTS = 'import hashlib,json,os,re,shutil,subprocess,sys,tempfile,time';
const CANDIDATES: readonly string[] = ['socket', 'http.client', 'urllib.request'];

interface Scenario {
  readonly name: string;
  readonly token: boolean;
  readonly receiver: ReceiverMode | 'none';
  readonly why: string;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'disconnected', token: false, receiver: 'none', why: 'no token file: one failed open()' },
  { name: 'refused', token: true, receiver: 'none', why: 'nothing listening on 4950' },
  { name: 'connected', token: true, receiver: 'ack', why: 'POST and ack round trip' },
  { name: 'hung', token: true, receiver: 'hang', why: 'receiver never answers: 150 ms timeout' },
];

interface ScenarioResult {
  readonly scenario: Scenario;
  /** Cost of the first fd_post in a process — it pays the deferred `import socket`. */
  readonly firstMs: readonly number[];
  /** Cost of every later fd_post: the network cost with the import already paid. */
  readonly steadyMs: readonly number[];
  readonly identical: boolean;
  readonly acks: readonly number[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Copies statusline.py into a scratch directory, patches the copy, and times both. */
class StatuslineSpike {
  private readonly workspace: string;
  private readonly plain: string;
  private readonly posting: string;
  private readonly payload: string;
  private readonly token = randomBytes(32).toString('hex');

  constructor(payloadName: string) {
    this.workspace = mkdtempSync(join(tmpdir(), 'fd-statusline-'));
    this.plain = join(this.workspace, 'plain.py');
    this.posting = join(this.workspace, 'posting.py');
    this.payload = readFileSync(join(FIXTURES, `${payloadName}.json`), 'utf8');

    copyFileSync(STATUSLINE, this.plain);
    const patched = StatuslinePatcher.fromRepo().apply(readFileSync(this.plain, 'utf8'));
    if (!patched.ok) throw new Error(`cannot patch statusline.py: ${patched.reason}`);
    writeFileSync(this.posting, patched.source, 'utf8');
  }

  public static async transport(): Promise<void> {
    console.log('marginal python import cost, on top of statusline.py’s own imports');
    for (const candidate of CANDIDATES) {
      const script = `${BASE_IMPORTS}\ns=time.perf_counter()\nimport ${candidate}\nprint('%.2f'%((time.perf_counter()-s)*1000))`;
      const runs: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const { stdout } = await execFileAsync(PYTHON, ['-c', script], { timeout: 30_000 });
        runs.push(Number(stdout.trim()));
      }
      const best = Math.min(...runs);
      console.log(`  ${candidate.padEnd(16)} ${best.toFixed(2).padStart(7)} ms   (min of 7)`);
    }
  }

  public dispose(): void {
    rmSync(this.workspace, { recursive: true, force: true });
  }

  public async run(): Promise<readonly ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    for (const scenario of SCENARIOS) {
      results.push(await this.attempt(scenario));
    }
    return results;
  }

  /**
   * `until()` renders a countdown at minute granularity, so a run that straddles a minute
   * boundary produces two different-but-correct renders. That is a false negative for the
   * byte-identity claim, so a mismatch is retried before it is believed.
   */
  private async attempt(scenario: Scenario): Promise<ScenarioResult> {
    let last = await this.measure(scenario);
    for (let retry = 1; retry < ATTEMPTS && !last.identical; retry += 1) {
      last = await this.measure(scenario);
    }
    return last;
  }

  private async measure(scenario: Scenario): Promise<ScenarioResult> {
    this.writeToken(scenario.token);
    const receiver =
      scenario.receiver === 'none'
        ? null
        : new StatuslineReceiver({ port: PORT, token: this.token, mode: scenario.receiver });
    await receiver?.start();
    try {
      const firstMs: number[] = [];
      const steadyMs: number[] = [];
      for (let run = 0; run < COST_PROCESSES; run += 1) {
        const cost = await this.cost();
        firstMs.push(cost.first);
        steadyMs.push(...cost.rest);
      }
      const renders = await this.renders();
      const first = renders[0]?.stdout ?? Buffer.alloc(0);
      return {
        scenario,
        firstMs,
        steadyMs,
        identical: renders.every((render) => render.stdout.equals(first)),
        acks: (receiver?.received() ?? []).map((post) => post.ackMs),
      };
    } finally {
      await receiver?.stop();
    }
  }

  /** Times fd_post itself, in one python process — see scripts/statusline-cost.py. */
  private async cost(): Promise<{ readonly first: number; readonly rest: readonly number[] }> {
    const payloadFile = join(this.workspace, 'payload.json');
    writeFileSync(payloadFile, this.payload, 'utf8');
    const { stdout } = await execFileAsync(
      PYTHON,
      [COST_DRIVER, BLOCK, payloadFile, String(COST_REPS)],
      { timeout: 120_000, env: { ...process.env, LOCALAPPDATA: this.workspace } },
    );
    const parsed: unknown = JSON.parse(stdout);
    const record = parsed as { first: number; rest: number[] };
    return { first: record.first, rest: record.rest };
  }

  /** Interleaved plain/posting renders — the byte-identity evidence (SEC-ING-3). */
  private async renders(): Promise<readonly RenderResult[]> {
    const probe = new RenderProbe({
      python: PYTHON,
      cwd: this.workspace,
      temp: this.workspace,
      localAppData: this.workspace,
    });
    await probe.run(this.plain, this.payload); // warm the git-state cache
    const renders: RenderResult[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      renders.push(await probe.run(this.plain, this.payload));
      renders.push(await probe.run(this.posting, this.payload));
    }
    return renders;
  }

  private writeToken(present: boolean): void {
    const directory = join(this.workspace, 'flightdeck');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'token');
    if (present) writeFileSync(file, this.token, 'utf8');
    else rmSync(file, { force: true });
  }
}

function report(results: readonly ScenarioResult[]): void {
  console.log(
    `\nfd_post cost in-process: ${String(COST_PROCESSES)} processes x ${String(COST_REPS)} calls; ` +
      `render compared over ${String(REPS)} interleaved pairs\n`,
  );
  console.log('  scenario       first min   first med   steady med   render');
  for (const result of results) {
    console.log(
      `  ${result.scenario.name.padEnd(14)}` +
        `${Math.min(...result.firstMs)
          .toFixed(2)
          .padStart(7)} ms` +
        `${median(result.firstMs).toFixed(2).padStart(10)} ms` +
        `${median(result.steadyMs).toFixed(2).padStart(11)} ms   ` +
        (result.identical ? 'byte-identical' : 'DIFFERS'),
    );
  }
  console.log('');
  for (const result of results) {
    const acks = result.acks;
    const seen =
      acks.length > 0
        ? `${String(acks.length)} posts, ack med ${median(acks).toFixed(2)} ms`
        : 'no posts';
    console.log(`  ${result.scenario.name.padEnd(14)}${result.scenario.why} — ${seen}`);
  }
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'measure';
  if (command === 'transport') {
    await StatuslineSpike.transport();
    return 0;
  }
  if (command !== 'measure') {
    console.error('usage: statusline-spike-cli.ts measure|transport [--payload warm|fresh]');
    return 2;
  }
  const index = process.argv.indexOf('--payload');
  const spike = new StatuslineSpike(index < 0 ? 'warm' : (process.argv[index + 1] ?? 'warm'));
  try {
    report(await spike.run());
  } finally {
    spike.dispose();
  }
  return 0;
}

process.exitCode = await main();

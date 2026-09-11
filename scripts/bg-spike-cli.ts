// P0-T4 runner. Drives one probe per invocation so each step can be observed as it happens.
//
//   node scripts/bg-spike-cli.ts attach <id> [--ms 8000]      attach once inside a ConPTY
//   node scripts/bg-spike-cli.ts double-attach <id>           attach twice; record the refusal
//   node scripts/bg-spike-cli.ts verb <arg...>                run a claude verb, timed
//
// Every capture is written under fixtures/raw/pty/ (git-ignored) for scripts/capture-fixtures.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeVerb, PtyProbe, visibleLines, type PtyProbeResult } from './bg-spike.ts';

const BINARY =
  process.env['FD_CLAUDE_BIN'] ??
  join(
    homedir(),
    'AppData',
    'Roaming',
    'npm',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
const CONFIG_DIR = process.env['FD_CONFIG_DIR'] ?? join(homedir(), '.claude-isg');
const SPIKE_CWD = process.env['FD_SPIKE_CWD'] ?? process.cwd();
const RAW_DIR = join(import.meta.dirname, '..', 'fixtures', 'raw', 'pty');

function numberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function record(name: string, body: Record<string, unknown>): string {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = join(RAW_DIR, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return file;
}

function summarise(label: string, result: PtyProbeResult): Record<string, unknown> {
  const lines = visibleLines(result.output);
  console.log(
    `${label}: ${String(result.bytes)} bytes, first byte ${result.firstByteMs.toFixed(1)} ms, ` +
      `exitedOnItsOwn=${String(result.exitedOnItsOwn)} exitCode=${String(result.exitCode)} ` +
      `keys=[${result.keysSent.join(',')}]`,
  );
  for (const line of lines.slice(0, 12)) console.log(`  | ${line}`);
  return {
    label,
    bytes: result.bytes,
    first_byte_ms: Number(result.firstByteMs.toFixed(2)),
    total_ms: Number(result.totalMs.toFixed(2)),
    exit_code: result.exitCode,
    exited_on_its_own: result.exitedOnItsOwn,
    keys_sent: result.keysSent,
    visible_lines: lines,
  };
}

function probeFor(id: string): PtyProbe {
  return new PtyProbe({
    binary: BINARY,
    args: ['attach', id],
    cwd: SPIKE_CWD,
    configDir: CONFIG_DIR,
    cols: 120,
    rows: 30,
  });
}

async function attachOnce(id: string, budgetMs: number): Promise<void> {
  // Ctrl+Z is the documented "drop back to your shell" key (RESEARCH.md B.1).
  const result = await probeFor(id).run(budgetMs, [
    { afterMs: Math.max(budgetMs - 2_000, 1_000), data: '\x1A', label: 'ctrl-z' },
  ]);
  const file = record('attach-single', summarise('attach', result));
  console.log(`wrote ${file}`);
}

async function doubleAttach(id: string, budgetMs: number): Promise<void> {
  const first = probeFor(id).run(budgetMs);
  // Give the first attach time to claim exclusivity before the second one asks for it.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const second = await probeFor(id).run(budgetMs - 3_000);
  const firstResult = await first;

  const file = record('attach-double', {
    first: summarise('attach#1 (holder)', firstResult),
    second: summarise('attach#2 (refused)', second),
  });
  console.log(`wrote ${file}`);
}

async function verb(args: readonly string[]): Promise<void> {
  const result = await new ClaudeVerb(BINARY, CONFIG_DIR).run(args, SPIKE_CWD);
  console.log(`exit=${String(result.exitCode)} in ${result.durationMs.toFixed(0)} ms`);
  if (result.stdout.length > 0) console.log(`stdout: ${result.stdout.trim()}`);
  if (result.stderr.length > 0) console.log(`stderr: ${result.stderr.trim()}`);
}

async function main(): Promise<void> {
  const [, , command, target] = process.argv;
  const budgetMs = numberFlag('--ms', 8_000);

  if (command === 'attach' && target !== undefined) return attachOnce(target, budgetMs);
  if (command === 'double-attach' && target !== undefined) return doubleAttach(target, budgetMs);
  if (command === 'verb') return verb(process.argv.slice(3));

  console.error('usage: bg-spike-cli.ts attach|double-attach <id> [--ms n] | verb <args…>');
  process.exitCode = 2;
}

await main();

// node-pty keeps the event loop alive after kill() — the process would otherwise never exit.
// P5a-T1: the real PTY host has to dispose explicitly rather than rely on the loop draining.
process.exit(process.exitCode ?? 0);

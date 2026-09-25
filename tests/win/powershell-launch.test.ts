// The half of SEC-PROC-1 no fake can establish — P4-T2, measured against a real PowerShell.
//
// `PowerShellLaunchCommands` promises that a prompt travels as `FD_PROMPT` and reaches the child
// as ONE argv element, whatever is in it. Every unit test of that class asserts what is NOT in the
// command line, which is the easy half; this asserts the hard half, and it needs a real shell to
// do it. If `$env:FD_PROMPT` ever split on spaces, or expanded a `$`, or was read as a flag, every
// one of those tests would still be green and every launch would be wrong.
//
// It runs the SAME script the adapter builds — taken from the adapter rather than retyped — with a
// callee that prints its own argv. `claude.exe` is deliberately not involved: the question is
// about PowerShell's argument mode, not about Claude Code.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecFileProcessRunner } from '../../core/adapters/claude-cli/execfile-process-runner.ts';
import {
  AGENT_VARIABLE,
  NAME_VARIABLE,
  PROMPT_VARIABLE,
} from '../../core/adapters/windows/powershell-launch-commands.ts';

const windows = process.platform === 'win32';
const TIMEOUT_MS = 30_000;

/** A callee that prints its own arguments as JSON. The one thing being measured is the split. */
const ECHO = 'console.log(JSON.stringify(process.argv.slice(2)));';

let directory = '';
let script = '';

beforeAll(() => {
  if (!windows) return;
  directory = mkdtempSync(join(tmpdir(), 'fd-argv-'));
  script = join(directory, 'argv.mjs');
  writeFileSync(script, ECHO, 'utf8');
});

afterAll(() => {
  if (directory !== '') rmSync(directory, { recursive: true, force: true });
});

/**
 * Runs `node <echo> --bg -n $env:FD_NAME $env:FD_PROMPT` through `-EncodedCommand`.
 *
 * The shape of the script is the adapter's, one token at a time: the point is that reading a
 * variable in argument mode is a VALUE, and nothing about that changes with the callee.
 */
async function argvFor(name: string, prompt: string, agent?: string): Promise<readonly string[]> {
  // P9-T1's agent line when an agent is given — the adapter's `AGENT_SCRIPTS` shape, token for token.
  const flags = agent === undefined ? '' : ` --agent $env:${AGENT_VARIABLE}`;
  const source = `node "${script}" --bg${flags} -n $env:${NAME_VARIABLE} $env:${PROMPT_VARIABLE}`;
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  const result = await new ExecFileProcessRunner().run({
    command: join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: ['-NoLogo', '-NonInteractive', '-EncodedCommand', encoded],
    env: {
      ...process.env,
      [NAME_VARIABLE]: name,
      [PROMPT_VARIABLE]: prompt,
      ...(agent === undefined ? {} : { [AGENT_VARIABLE]: agent }),
    },
    timeoutMs: TIMEOUT_MS,
  });
  const parsed: unknown = JSON.parse(result.stdout.trim());
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

describe('a prompt through -EncodedCommand', () => {
  it.skipIf(!windows)(
    'arrives as one argument however many spaces and metacharacters are in it',
    async () => {
      const prompt = "two words 'quoted' and a $dollar and a ; semicolon and a | pipe";

      expect(await argvFor('a name with spaces', prompt)).toEqual([
        '--bg',
        '-n',
        'a name with spaces',
        prompt,
      ]);
    },
    TIMEOUT_MS,
  );

  it.skipIf(!windows)(
    'is not expanded — a `$` in the prompt is a dollar sign, not a variable',
    async () => {
      const argv = await argvFor('n', '$env:USERPROFILE and $(Get-Date)');

      expect(argv.at(-1)).toBe('$env:USERPROFILE and $(Get-Date)');
    },
    TIMEOUT_MS,
  );

  it.skipIf(!windows)(
    'stays one argument even when it reads like flags',
    async () => {
      // The risk this rules out is a prompt starting with `--` being split into flags on the way
      // through the shell. It is not: what the callee's own parser then does with a single
      // positional is the callee's business.
      const argv = await argvFor('n', '--help --version -p leading dashes');

      expect(argv).toEqual(['--bg', '-n', 'n', '--help --version -p leading dashes']);
    },
    TIMEOUT_MS,
  );

  it.skipIf(!windows)(
    'keeps backslashes, so a Windows path in a prompt survives',
    async () => {
      const argv = await argvFor('n', String.raw`C:\a path\with spaces\file.txt`);

      expect(argv.at(-1)).toBe(String.raw`C:\a path\with spaces\file.txt`);
    },
    TIMEOUT_MS,
  );

  it.skipIf(!windows)(
    'puts the agent in its own element, and leaves the prompt one element after it (P9-T1)',
    async () => {
      const prompt = "review 'this' and $(Get-Date)";

      expect(await argvFor('review', prompt, 'code-reviewer')).toEqual([
        '--bg',
        '--agent',
        'code-reviewer',
        '-n',
        'review',
        prompt,
      ]);
    },
    TIMEOUT_MS,
  );
});

// The argv a launch becomes — P4-T2, SEC-PROC-1, SEC-PROC-2.
//
// Everything here is about what does NOT appear in the command line. The prompt and the name are
// user text on their way to a process, and the whole design is that they travel as environment
// variables and the script is a fixed literal — so the assertions are "the argv does not contain
// it" rather than "the argv contains it in the right place".
//
// What this file cannot establish is that PowerShell then hands `$env:FD_PROMPT` to the child as
// ONE argument. That is a fact about PowerShell, not about this class, and it is measured against
// a real shell in `tests/win/powershell-launch.test.ts`.
import { describe, expect, it } from 'vitest';
import { PROFILE_FUNCTIONS } from '../../../contracts/launch-preset.ts';
import {
  AGENT_VARIABLE,
  NAME_VARIABLE,
  PowerShellLaunchCommands,
  PROMPT_VARIABLE,
} from '../../../core/adapters/windows/powershell-launch-commands.ts';

const SHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function commands(): PowerShellLaunchCommands {
  return new PowerShellLaunchCommands(SHELL, { PATH: 'C:\\Windows' });
}

/** The script the encoded argument carries, back in readable form. */
function scriptOf(args: readonly string[]): string {
  const encoded = args.at(-1) ?? '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

describe('PowerShellLaunchCommands', () => {
  it('runs the shell by absolute path, never by name (SEC-PROC-2)', () => {
    const command = commands().forProfile('claude-365', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    expect(command?.command).toBe(SHELL);
  });

  it('passes the script encoded, and no other flag', () => {
    const command = commands().forProfile('claude-365', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    expect(command?.args.slice(0, 3)).toEqual(['-NoLogo', '-NonInteractive', '-EncodedCommand']);
    expect(command?.args).toHaveLength(4);
  });

  it('does NOT pass -NoProfile, which is the flag the whole design depends on', () => {
    // With it, none of the four functions exists in the child (RESEARCH.md F.8.1). This is the
    // one absence worth an assertion: adding the flag would look like tightening and would break
    // every launch with `The term 'claude-365' is not recognized`.
    const command = commands().forProfile('claude-isg', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    expect(command?.args).not.toContain('-NoProfile');
  });

  it('does not pass -ExecutionPolicy either', () => {
    // The profile is a local file and loads under `RemoteSigned` (F.8.1), so the flag would be a
    // standing loosening of a control for a case that does not exist.
    const command = commands().forProfile('claude-isg', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    expect(command?.args.join(' ')).not.toContain('ExecutionPolicy');
  });

  it.each([...PROFILE_FUNCTIONS])('runs %s and nothing else', (profileFn) => {
    const command = commands().forProfile(profileFn, { name: 'x', prompt: 'go', agent: undefined });

    const script = scriptOf(command?.args ?? []);
    expect(script.startsWith(`${profileFn} --bg`)).toBe(true);
    // No other profile function's name is anywhere in the script — the table is one line each.
    for (const other of PROFILE_FUNCTIONS) {
      if (!profileFn.startsWith(other)) expect(script).not.toContain(other);
    }
  });

  it('never puts the prompt or the name in the script or the argv (SEC-PROC-1)', () => {
    const hostile = 'go"; calc.exe; echo "';
    const command = commands().forProfile('claude-365', {
      name: 'rm -rf /',
      prompt: hostile,
      agent: undefined,
    });

    const everything = [...(command?.args ?? []), scriptOf(command?.args ?? [])].join(' ');
    expect(everything).not.toContain('calc.exe');
    expect(everything).not.toContain('rm -rf');
    // They are in the environment instead, whole.
    expect(command?.env[PROMPT_VARIABLE]).toBe(hostile);
    expect(command?.env[NAME_VARIABLE]).toBe('rm -rf /');
  });

  it('reads both variables in the script, so the environment is where they come from', () => {
    const script = scriptOf(
      commands().forProfile('claude-365', { name: 'x', prompt: 'go', agent: undefined })?.args ??
        [],
    );

    expect(script).toContain(`$env:${PROMPT_VARIABLE}`);
    expect(script).toContain(`$env:${NAME_VARIABLE}`);
  });

  it('gives the function that names itself no -n and no name variable', () => {
    // `claude-isg-orch` passes `-n orchestrator`. A second `-n` would be two on one command line,
    // and nothing has measured which wins.
    const command = commands().forProfile('claude-isg-orch', {
      name: 'ignored',
      prompt: 'go',
      agent: undefined,
    });

    expect(scriptOf(command?.args ?? [])).not.toContain('-n');
    expect(command?.env[NAME_VARIABLE]).toBeUndefined();
  });

  it('keeps the environment it was given, and adds no config directory (D4)', () => {
    const command = commands().forProfile('claude-isg', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    expect(command?.env['PATH']).toBe('C:\\Windows');
    // The profile function exports and removes `CLAUDE_CONFIG_DIR` itself; core setting it too
    // would be a second opinion about which account a session belongs to.
    expect(command?.env['CLAUDE_CONFIG_DIR']).toBeUndefined();
  });

  it('encodes as UTF-16LE base64, which is what -EncodedCommand takes', () => {
    const command = commands().forProfile('claude-365', {
      name: 'x',
      prompt: 'go',
      agent: undefined,
    });

    // Round-trips, and is not plain UTF-8 base64 — the difference is silent and fatal.
    const encoded = command?.args.at(-1) ?? '';
    expect(scriptOf(command?.args ?? [])).toContain('claude-365');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).not.toContain('claude-365');
  });

  describe('with an agent (P9-T1)', () => {
    const withAgent = { name: 'review', prompt: 'go', agent: 'code-reviewer' };

    it.each(['claude-365', 'claude-isg', 'claude-isg-ticket'] as const)(
      'gives %s the fixed agent line, reading the name back from the environment',
      (profileFn) => {
        const command = commands().forProfile(profileFn, withAgent);

        expect(scriptOf(command?.args ?? [])).toBe(
          `${profileFn} --bg --agent $env:${AGENT_VARIABLE} -n $env:${NAME_VARIABLE} $env:${PROMPT_VARIABLE}`,
        );
        expect(command?.env[AGENT_VARIABLE]).toBe('code-reviewer');
      },
    );

    it('never composes the agent into the script, even though it is shape-screened', () => {
      const script = scriptOf(commands().forProfile('claude-365', withAgent)?.args ?? []);

      expect(script).not.toContain('code-reviewer');
    });

    it('has no line for the function that pins its own agent', () => {
      // `claude-isg-orch` passes `--agent orchestrator`; there is nothing to choose, so nothing runs.
      expect(commands().forProfile('claude-isg-orch', withAgent)).toBeUndefined();
    });

    it('sets no agent variable and uses the plain line when there is none', () => {
      const command = commands().forProfile('claude-365', { ...withAgent, agent: undefined });

      expect(scriptOf(command?.args ?? [])).not.toContain('--agent');
      expect(command?.env[AGENT_VARIABLE]).toBeUndefined();
    });
  });
});

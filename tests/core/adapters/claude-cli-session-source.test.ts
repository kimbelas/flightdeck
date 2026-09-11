// P1-T3 — the listing to the domain, against the captured shapes.
//
// The fixture is the contract. D29's rules are what these assert: liveness is `pid`, not `state`;
// `status` may be absent on a live session; an interactive record carries no `state` at all.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCliSessionSource } from '../../../core/adapters/claude-cli/claude-cli-session-source.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';

const FIXTURE: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../fixtures/agents/live-mixed.json'), 'utf8'),
);
const LISTING = JSON.stringify((FIXTURE as { sessions: unknown[] }).sessions);

const silent = new FakeLogger();

function source(runner: FakeProcessRunner): ClaudeCliSessionSource {
  // A named executable, so the adapter never depends on this machine having Claude installed.
  return new ClaudeCliSessionSource(
    new ClaudeInstall('C:\\home', 'C:\\claude.exe'),
    runner,
    silent,
  );
}

describe('ClaudeCliSessionSource', () => {
  it('parses every record in the captured listing', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: LISTING });

    const sweep = await source(runner).sweep('365');

    expect(sweep.sessions).toHaveLength(9);
    expect(sweep.failed).toBe(false);
    expect(sweep.skipped).toBe(0);
  });

  it('runs `agents --json --all` with the subscription’s config dir and nothing else', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: LISTING });

    await source(runner).sweep('isg');

    const [request] = runner.requests;
    // --all or a stopped session reads as gone — RESEARCH.md F.2.2, and P1-T4 depends on it.
    expect(request?.args).toEqual(['agents', '--json', '--all']);
    expect(request?.env['CLAUDE_CONFIG_DIR']).toBe(join('C:\\home', '.claude-isg'));
    expect(request?.command).toBe('C:\\claude.exe');
  });

  it('reads liveness from pid, never from state (D29)', async () => {
    const runner = new FakeProcessRunner();
    // `state: working` but no pid — the record of a session that is not running.
    runner.willReturn({
      stdout: JSON.stringify([
        { sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', state: 'working', kind: 'background' },
      ]),
    });

    const sweep = await source(runner).sweep('365');

    expect(sweep.sessions[0]?.state.isLive).toBe(false);
  });

  it('accepts a live record with no status at all (F.2.1)', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: JSON.stringify([
        {
          sessionId: 'aaaaaaaa-0000-0000-0000-000000000002',
          pid: 123,
          state: 'working',
          kind: 'background',
        },
      ]),
    });

    const sweep = await source(runner).sweep('365');

    expect(sweep.sessions[0]?.state.isLive).toBe(true);
    expect(sweep.sessions[0]?.state.status).toBeUndefined();
  });

  it.each([
    { why: 'a non-zero exit', result: { code: 1, stdout: '' } },
    { why: 'a timeout', result: { timedOut: true, stdout: '' } },
    { why: 'output that is not JSON', result: { stdout: 'claude: command failed' } },
    { why: 'output that is not an array', result: { stdout: '{"sessions":[]}' } },
  ])('never throws on $why', async ({ result }) => {
    const runner = new FakeProcessRunner();
    runner.willReturn(result);

    await expect(source(runner).sweep('365')).resolves.toBeDefined();
  });

  it('reports a failed sweep rather than an empty one', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1 });

    const sweep = await source(runner).sweep('365');

    // "No sessions" and "I could not look" are different answers.
    expect(sweep.failed).toBe(true);
  });

  it('drops a record it cannot name and counts it, rather than losing the sweep', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({
      stdout: JSON.stringify([
        { sessionId: 'aaaaaaaa-0000-0000-0000-000000000003', pid: 1, kind: 'interactive' },
        { noSessionId: true },
        'not even an object',
      ]),
    });

    const sweep = await source(runner).sweep('365');

    expect(sweep.sessions).toHaveLength(1);
    expect(sweep.skipped).toBe(2);
  });

  it('keeps a record whose kind or state is unknown, losing only that field', async () => {
    const runner = new FakeProcessRunner();
    // The shape-change case: a Claude Code update adds a third kind.
    runner.willReturn({
      stdout: JSON.stringify([
        {
          sessionId: 'aaaaaaaa-0000-0000-0000-000000000004',
          pid: 9,
          kind: 'teleported',
          state: 'hibernating',
        },
      ]),
    });

    const sweep = await source(runner).sweep('365');

    expect(sweep.sessions).toHaveLength(1);
    expect(sweep.skipped).toBe(0);
    expect(sweep.sessions[0]?.kind).toBe('interactive');
  });

  it('fails the sweep when no Claude binary was found, without spawning', async () => {
    const runner = new FakeProcessRunner();
    const noClaude = new ClaudeCliSessionSource(new ClaudeInstall('C:\\home', ''), runner, silent);

    const sweep = await noClaude.sweep('365');

    expect(sweep.failed).toBe(true);
    expect(runner.requests).toHaveLength(0);
  });
});

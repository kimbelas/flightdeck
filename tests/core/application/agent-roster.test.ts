// Which agents a folder may start under — P9-T1.
//
// The roster is the allowlist, so every case is about what it REFUSES: a name that is not
// agent-shaped, a folder outside every project, a project with no agents, and a command that is
// not an agent at all. The asset reader is a one-method double; what it parses is settled in
// `claude-asset-reader.test.ts`.
import { describe, expect, it } from 'vitest';
import type { ClaudeAsset } from '../../../contracts/claude-assets.ts';
import type { ProjectRecord } from '../../../contracts/project.ts';
import { AgentRoster, type RosterRegistry } from '../../../core/application/agent-roster.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;
const TREE = String.raw`C:\Users\belas\Documents\development\app-next\.claude\worktrees\X-1`;
const DOCS_TOOL = String.raw`C:\Users\belas\Documents\development\docs-tool`;
const OUTSIDE = String.raw`C:\Windows`;

function asset(name: string, kind: ClaudeAsset['kind'] = 'agent'): ClaudeAsset {
  return { kind, name, description: undefined, model: undefined, tools: [] };
}

/** Two imported projects; only `app-next` has agents, and one of its names is not agent-shaped. */
class StubRegistry implements RosterRegistry {
  public list(): readonly ProjectRecord[] {
    return [
      { path: APP_NEXT, name: 'app-next', importedAt: 1 },
      { path: DOCS_TOOL, name: 'docs-tool', importedAt: 2 },
    ];
  }

  public resolveRoot(path: string): Promise<Result<string, string>> {
    const known = [APP_NEXT, DOCS_TOOL].find((root) => root.toLowerCase() === path.toLowerCase());
    return Promise.resolve(known === undefined ? err('not an imported project') : ok(known));
  }

  public resolveDirectory(path: string): Promise<Result<string, string>> {
    const inside = [APP_NEXT, DOCS_TOOL].some((root) =>
      path.toLowerCase().startsWith(root.toLowerCase()),
    );
    return Promise.resolve(inside ? ok(path) : err('outside every imported project'));
  }
}

function roster(): { subject: AgentRoster; asked: string[] } {
  const asked: string[] = [];
  const assets = {
    assets: (claudeDir: string): Promise<readonly ClaudeAsset[]> => {
      asked.push(claudeDir);
      const held = [
        asset('reviewer'),
        asset('code-reviewer'),
        asset('Shouty Name'),
        asset('deploy', 'command'),
      ];
      return Promise.resolve(claudeDir.startsWith(APP_NEXT) ? held : []);
    },
  };
  // P9-T5. One user-scope plugin agent everywhere, and one whose scoped name is too long to be
  // agent-shaped.
  const plugins = {
    assets: (projectPaths: readonly string[]): Promise<readonly ClaudeAsset[]> => {
      asked.push(`plugins:${projectPaths.join('|')}`);
      return Promise.resolve([
        { ...asset('bash-script-auditor'), plugin: 'shell-review' },
        { ...asset('x'.repeat(65)), plugin: 'too-long' },
      ]);
    },
  };
  return { subject: new AgentRoster({ registry: new StubRegistry(), assets, plugins }), asked };
}

describe('AgentRoster.namesFor', () => {
  it('lists the agent-shaped agents under the project, sorted, and nothing else', async () => {
    // `Shouty Name` is not `AGENT_SHAPE` and `deploy` is a command: neither may reach an argv.
    expect(await roster().subject.namesFor(APP_NEXT)).toEqual([
      'code-reviewer',
      'reviewer',
      'shell-review:bash-script-auditor',
    ]);
  });

  it('reads the root .claude and its plugins, and nothing composed from the request', async () => {
    const { subject, asked } = roster();

    await subject.namesFor(APP_NEXT);

    expect(asked).toEqual([`${APP_NEXT}\\.claude`, `plugins:${APP_NEXT}|${APP_NEXT}`]);
  });

  it('holds a plugin agent under its scoped name only (P9-T5)', async () => {
    const { subject } = roster();

    expect(await subject.allows(DOCS_TOOL, 'shell-review:bash-script-auditor')).toBe(true);
    // Claude Code would resolve the bare name too, but the roster is the scoped name the map offers.
    expect(await subject.allows(DOCS_TOOL, 'bash-script-auditor')).toBe(false);
  });

  it('is empty for a folder nobody imported', async () => {
    expect(await roster().subject.namesFor(OUTSIDE)).toEqual([]);
  });
});

describe('AgentRoster.allows', () => {
  it('allows a roster agent in the project root', async () => {
    expect(await roster().subject.allows(APP_NEXT, 'reviewer')).toBe(true);
  });

  it('allows it in a worktree under the project, against the ROOT roster', async () => {
    const { subject, asked } = roster();

    expect(await subject.allows(TREE, 'reviewer')).toBe(true);
    expect(asked).toEqual([`${APP_NEXT}\\.claude`, `plugins:${APP_NEXT}|${APP_NEXT}`]);
  });

  it('refuses a name the roster does not hold', async () => {
    expect(await roster().subject.allows(APP_NEXT, 'ghost')).toBe(false);
  });

  it('refuses an agent that belongs to a different project', async () => {
    expect(await roster().subject.allows(DOCS_TOOL, 'reviewer')).toBe(false);
  });

  it('refuses a folder outside every project without reading anything', async () => {
    const { subject, asked } = roster();

    expect(await subject.allows(OUTSIDE, 'reviewer')).toBe(false);
    expect(asked).toEqual([]);
  });

  it('refuses a name that is not agent-shaped before anything is read', async () => {
    const { subject, asked } = roster();

    expect(await subject.allows(APP_NEXT, 'reviewer; calc.exe')).toBe(false);
    expect(asked).toEqual([]);
  });
});

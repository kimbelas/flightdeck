// MCP servers, plugins, marketplaces and permissions — P3-T3, SPEC §5.1.
//
// The shapes are the measured ones: a `.mcp.json` with one stdio server whose command is an
// absolute path into `fnm`, and both config dirs' `enabledPlugins`/`extraKnownMarketplaces` with
// `claude-kit` in them (DECISIONS.md D26). The case doing the most work is the one asserting what
// does NOT come out — a server's command line and its environment never leave core.
import { describe, expect, it } from 'vitest';
import {
  parseMcpServers,
  parseNameList,
  parsePermissionRules,
  readMarketplaces,
  readMcpServers,
  readPermissions,
  readPlugins,
} from '../../contracts/claude-settings.ts';

const MCP = {
  mcpServers: {
    'chrome-devtools': {
      command: 'C:\\Users\\belas\\AppData\\Roaming\\fnm\\node.exe',
      args: ['chrome-devtools-mcp.js', '--browserUrl', 'http://127.0.0.1:9222'],
      env: { SECRET_TOKEN: 'never-leaves-core' },
    },
    remote: {
      type: 'http',
      url: 'https://example.invalid',
      headers: { Authorization: 'Bearer x' },
    },
  },
};

const SETTINGS = {
  permissions: { allow: ['Bash(git status:*)', 'Bash(npm run:*)'], deny: ['Read(.env)'] },
  enabledPlugins: { 'context-hygiene@claude-kit': true, 'shell-review@claude-kit': false },
  extraKnownMarketplaces: { 'claude-kit': { source: { source: 'directory' } } },
};

describe('readMcpServers', () => {
  it('names the servers and how each is reached', () => {
    expect(readMcpServers(MCP)).toEqual([
      { name: 'chrome-devtools', transport: 'stdio' },
      { name: 'remote', transport: 'http' },
    ]);
  });

  it('never carries the command line, the arguments, the environment or a header', () => {
    // The point of the row is which servers a repository declares. A panel that printed a bearer
    // because it was in a config file would be the leak SEC-FS-2 exists to prevent.
    const wire = JSON.stringify(readMcpServers(MCP));
    expect(wire).not.toContain('fnm');
    expect(wire).not.toContain('never-leaves-core');
    expect(wire).not.toContain('Bearer');
  });

  it('defaults a `command` entry with no `type` to stdio, which is the documented shape', () => {
    expect(readMcpServers({ mcpServers: { one: { command: 'node' } } })[0]?.transport).toBe(
      'stdio',
    );
  });

  it('answers nothing for a file that is not one, rather than throwing', () => {
    expect(readMcpServers(undefined)).toEqual([]);
    expect(readMcpServers({ mcpServers: [] })).toEqual([]);
  });
});

describe('readPlugins and readMarketplaces', () => {
  it('lists only the plugins that are switched on', () => {
    // A `false` is a plugin the owner deliberately disabled; listing it beside the enabled ones
    // would say the opposite of what the file says.
    expect(readPlugins(SETTINGS)).toEqual(['context-hygiene@claude-kit']);
  });

  it('lists a marketplace by name and not by its path on this machine', () => {
    expect(readMarketplaces(SETTINGS)).toEqual(['claude-kit']);
  });

  it('answers nothing when the keys are absent', () => {
    expect(readPlugins({})).toEqual([]);
    expect(readMarketplaces({})).toEqual([]);
  });
});

describe('readPermissions', () => {
  it('carries the rules, not only the counts — SPEC asks for the list on expand', () => {
    expect(readPermissions(SETTINGS)).toEqual({
      allow: ['Bash(git status:*)', 'Bash(npm run:*)'],
      deny: ['Read(.env)'],
      ask: [],
      defaultMode: undefined,
    });
  });

  it('reads `defaultMode`, which changes what the other two mean', () => {
    // One config dir sets `auto` and the other does not set it at all — 34 allows under each is a
    // different machine.
    expect(readPermissions({ permissions: { defaultMode: 'auto' } }).defaultMode).toBe('auto');
  });

  it('answers empty lists for a file with no permissions', () => {
    expect(readPermissions({}).allow).toEqual([]);
    expect(readPermissions(undefined).deny).toEqual([]);
  });
});

describe('the wire parsers', () => {
  it('round-trip what the readers produced', () => {
    expect(parseMcpServers(readMcpServers(MCP))).toEqual(readMcpServers(MCP));
    expect(parsePermissionRules(readPermissions(SETTINGS))).toEqual(readPermissions(SETTINGS));
    expect(parseNameList(readPlugins(SETTINGS))).toEqual(['context-hygiene@claude-kit']);
  });

  it('drop what they cannot read rather than refusing the reply', () => {
    expect(parseMcpServers([{ name: '' }, 7, { name: 'ok' }])).toEqual([
      { name: 'ok', transport: 'stdio' },
    ]);
    expect(parseNameList(['a', 3, ''])).toEqual(['a']);
    expect(parseNameList('a')).toEqual([]);
  });
});

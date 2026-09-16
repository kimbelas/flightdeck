// The three remaining rows of SPEC §5.1's config table — MCP servers, plugins, permissions (P3-T3).
//
// One file rather than three, because they are two files' worth of shape and the same kind of
// reading: a `.mcp.json` and a `settings.json`, parsed for the handful of fields SPEC names and
// nothing else. `hook-timeline.ts` is separate because flattening three levels of nesting into a
// timeline is a job with a story; this is field access with bounds on it.
//
// **Names and patterns, never values.** An MCP server entry carries a command line with
// absolute paths in it and, for a remote server, sometimes a header with a token — so what comes
// out of here is the server's NAME and how it is reached, and never its `env`, its `headers` or
// its arguments. That is not a size limit dressed up as a rule: `.mcp.json` is a file an imported
// repository controls, the deck renders what core sends, and a panel that displayed a bearer
// because it was in a config file would be the leak SEC-FS-2 exists to prevent.
//
// **Permissions come with their rules, not only their counts.** SPEC asks for "counts, full list
// on expand", and a count is `length` — sending only the number would put the expand behind a
// second request for a list that is already in memory. The rules are patterns like
// `Bash(git status:*)`; they are the owner's own and they are what makes a count mean something.
//
// **`defaultMode` is the field that changes what the other two mean.** An `auto` config with 34
// allows is a different machine from a `default` one with the same 34, and the acceptance targets
// differ on exactly that — one config dir sets `auto`, the other does not set it at all.

/** How an MCP server is reached. Closed, so the deck draws a badge rather than echoing a field. */
export const MCP_TRANSPORTS = ['stdio', 'sse', 'http'] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** One entry of `.mcp.json → mcpServers`. See the header on what is deliberately absent. */
export interface McpServer {
  readonly name: string;
  /**
   * `stdio` for a local `command`, otherwise whatever `type` says.
   *
   * Defaulted rather than left absent because an entry with a `command` and no `type` is the
   * documented stdio shape and is what the acceptance target has — reporting "unknown" for the
   * common case would make the badge noise.
   */
  readonly transport: McpTransport;
}

/** `permissions` from a `settings.json`, with the rules SPEC's expand needs. */
export interface PermissionRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly ask: readonly string[];
  /** `auto`, `default`, `plan`, … as written, or `undefined` when the file does not set one. */
  readonly defaultMode: string | undefined;
}

/** How much of a `.mcp.json` is read. Larger than every measured one by two orders of magnitude. */
export const MAX_MCP_BYTES = 64 * 1024;

/** A rule is a pattern, not a script. */
const MAX_RULE_CHARS = 200;

/** More rules than a person writes by hand — 34 is the largest measured. */
const MAX_RULES = 500;

/** Servers, plugins and marketplaces are all handfuls. This is the bound, not the expectation. */
const MAX_NAMES = 100;

const MAX_NAME_CHARS = 120;

/**
 * The servers a `.mcp.json` declares.
 *
 * @param mcp the parsed file, or anything else. A repository with no `.mcp.json` and one whose
 * `.mcp.json` is not an object answer the same empty list — both draw no servers, and a panel is
 * not where a malformed config gets reported.
 * @throws never.
 */
export function readMcpServers(mcp: unknown): readonly McpServer[] {
  const servers = child(mcp, 'mcpServers');
  if (servers === undefined) return [];
  const found: McpServer[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (name === '') continue;
    found.push({ name: name.slice(0, MAX_NAME_CHARS), transport: transportOf(entry) });
    if (found.length >= MAX_NAMES) break;
  }
  return found;
}

/**
 * The plugins a `settings.json` turns ON — `context-hygiene@claude-kit`, and the like.
 *
 * `enabledPlugins` is a map of name to boolean, and a `false` is a plugin the owner deliberately
 * switched off. Listing it beside the enabled ones would say the opposite of what the file says.
 *
 * @throws never.
 */
export function readPlugins(settings: unknown): readonly string[] {
  const plugins = child(settings, 'enabledPlugins');
  if (plugins === undefined) return [];
  return Object.entries(plugins)
    .filter(([name, enabled]) => name !== '' && enabled === true)
    .map(([name]) => name.slice(0, MAX_NAME_CHARS))
    .slice(0, MAX_NAMES);
}

/**
 * The marketplaces a `settings.json` knows about — `claude-kit` on both config dirs (D26).
 *
 * The keys only. A `directory` marketplace's value is a path on this machine, and the name is what
 * SPEC's row asks for.
 *
 * @throws never.
 */
export function readMarketplaces(settings: unknown): readonly string[] {
  const known = child(settings, 'extraKnownMarketplaces');
  if (known === undefined) return [];
  return Object.keys(known)
    .filter((name) => name !== '')
    .map((name) => name.slice(0, MAX_NAME_CHARS))
    .slice(0, MAX_NAMES);
}

/** `permissions` from a parsed `settings.json`. Every list is empty when the file has none. */
export function readPermissions(settings: unknown): PermissionRules {
  const permissions = child(settings, 'permissions');
  const mode = permissions?.['defaultMode'];
  return {
    allow: rules(permissions?.['allow']),
    deny: rules(permissions?.['deny']),
    ask: rules(permissions?.['ask']),
    defaultMode:
      typeof mode === 'string' && mode !== '' ? mode.slice(0, MAX_NAME_CHARS) : undefined,
  };
}

/** Servers from a `GET /projects/map` body, dropping what this build cannot read. @throws never. */
export function parseMcpServers(value: unknown): readonly McpServer[] {
  if (!Array.isArray(value)) return [];
  const servers: McpServer[] = [];
  for (const entry of value) {
    const fields = child(entry, undefined);
    const name = fields?.['name'];
    if (typeof name !== 'string' || name === '') continue;
    const transport = MCP_TRANSPORTS.find((known) => known === fields?.['transport']) ?? 'stdio';
    servers.push({ name: name.slice(0, MAX_NAME_CHARS), transport });
  }
  return servers.slice(0, MAX_NAMES);
}

/** Permissions from a `GET /projects/map` body. @throws never. */
export function parsePermissionRules(value: unknown): PermissionRules {
  return readPermissions({ permissions: value });
}

/** A list of names from the wire, kept to the strings in it. @throws never. */
export function parseNameList(value: unknown): readonly string[] {
  return rules(value).slice(0, MAX_NAMES);
}

/** `type` when it names a transport this build knows, `stdio` otherwise. See `McpServer`. */
function transportOf(entry: unknown): McpTransport {
  const type = child(entry, undefined)?.['type'];
  return MCP_TRANSPORTS.find((known) => known === type) ?? 'stdio';
}

/** The strings in an array, capped both ways. A non-array is no rules rather than a refusal. */
function rules(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '') kept.push(entry.slice(0, MAX_RULE_CHARS));
    if (kept.length >= MAX_RULES) break;
  }
  return kept;
}

/**
 * An object's own entries, or `undefined` for anything that is not one.
 *
 * @param key when given, the named child rather than the object itself.
 */
function child(value: unknown, key: string | undefined): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (key === undefined) return fields;
  return child(fields[key], undefined);
}

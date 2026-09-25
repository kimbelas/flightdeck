// Which tools a transcript line called — P7-T2, SPEC §5.8's `tool` filter, SEC-DATA-1.
//
// **Names only, never inputs.** A `tool_use` block's `input` holds the command, the file being
// written or the URL being fetched — the most sensitive field in the record, and the one
// `transcript-record.ts` already refuses to read. The filter asks "did this session run `Bash`",
// which the NAME answers; what it ran is not indexed, because it is not read.
//
// A third reader beside `transcript-prose.ts` and `transcript-record.ts` rather than a field on
// either. The prose reader returns one excerpt per line and a tool call is not prose; the record
// reader returns the FIRST tool in a turn, which is the right answer for "doing right now" and the
// wrong one for a filter — a turn that ran `Read` then `Bash` ran `Bash`.

/**
 * What a tool name may look like on the wire and in the index.
 *
 * Built-ins are one word (`Bash`, `WebFetch`); MCP tools are `mcp__<server>__<tool>`, and a server
 * name can carry `-` and `.`. 128 is far past the longest either ships with and short enough that a
 * name is never a payload.
 */
export const TOOL_NAME = /^[A-Za-z][\w.:-]{0,127}$/u;

/** The most tool names one reply carries. The owner's picker, not an export. */
export const MAX_TOOL_NAMES = 60;

/**
 * Every tool one parsed transcript line called, in order, each once.
 *
 * `[]` for anything that is not an assistant turn with a `tool_use` in it, which is most lines.
 *
 * @throws never.
 */
export function readToolNames(value: unknown): readonly string[] {
  const fields = asRecord(value);
  if (fields?.['type'] !== 'assistant') return [];
  const content: unknown = asRecord(fields['message'])?.['content'];
  if (!Array.isArray(content)) return [];
  const called = content.map((item) => {
    const block = asRecord(item);
    return block?.['type'] === 'tool_use' ? block['name'] : undefined;
  });
  return screened(called);
}

/** The tool names in a `GET /search/tools` body, screened. @throws never. */
export function parseToolNames(value: unknown): readonly string[] {
  const tools = asRecord(value)?.['tools'];
  return Array.isArray(tools) ? screened(tools).slice(0, MAX_TOOL_NAMES) : [];
}

/** The strings in `values` that are tool names, in order, each once. */
function screened(values: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && TOOL_NAME.test(value) && !names.includes(value)) {
      names.push(value);
    }
  }
  return names;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

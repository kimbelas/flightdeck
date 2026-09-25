// Which tools a line called — P7-T2's tool filter. Names only; never an input (SEC-DATA-1).
import { describe, expect, it } from 'vitest';
import { MAX_TOOL_NAMES, parseToolNames, readToolNames } from '../../contracts/transcript-tools.ts';

function assistant(content: unknown): unknown {
  return { type: 'assistant', message: { content } };
}

describe('readToolNames', () => {
  it('reads every tool a turn called, in order, each once', () => {
    const line = assistant([
      { type: 'text', text: 'Running it.' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\secret.txt' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'wrangler deploy' } },
      { type: 'tool_use', name: 'Read', input: {} },
    ]);

    expect(readToolNames(line)).toEqual(['Read', 'Bash']);
  });

  it('reads an MCP tool by its full name', () => {
    expect(
      readToolNames(assistant([{ type: 'tool_use', name: 'mcp__github__create_pr' }])),
    ).toEqual(['mcp__github__create_pr']);
  });

  it.each([
    ['a user line', { type: 'user', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }],
    ['an assistant line with string content', assistant('hello')],
    ['a turn with text only', assistant([{ type: 'text', text: 'hi' }])],
    ['a name that is not a name', assistant([{ type: 'tool_use', name: '<b>x</b>' }])],
    ['a name that is not a string', assistant([{ type: 'tool_use', name: 7 }])],
    ['nothing at all', undefined],
  ])('reads nothing from %s', (source, line) => {
    expect(source).not.toBe('');
    expect(readToolNames(line)).toEqual([]);
  });
});

describe('parseToolNames', () => {
  it('reads the names in a reply, screened and de-duplicated', () => {
    expect(parseToolNames({ tools: ['Bash', 'Bash', '<x>', 3, 'Read'] })).toEqual(['Bash', 'Read']);
  });

  it('caps the list', () => {
    const tools = [...Array(100).keys()].map((index) => `T${String(index)}`);

    expect(parseToolNames({ tools })).toHaveLength(MAX_TOOL_NAMES);
  });

  it.each([undefined, {}, { tools: 'Bash' }])('reads %o as no tools', (value) => {
    expect(parseToolNames(value)).toEqual([]);
  });
});

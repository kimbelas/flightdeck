// Frontmatter, as the acceptance targets actually write it — P3-T3.
//
// The shapes here are copied from the files the P3 gate names: an agent with `tools` and
// `maxTurns`, a command with a quoted `argument-hint` and no `name` at all, a skill with
// `allowed-tools`. What is deliberately NOT tested is a YAML feature nobody uses — this parser is
// a line reader by decision, and a test for block lists would be a test for a promise the header
// declines to make.
import { describe, expect, it } from 'vitest';
import { parseAsset, parseClaudeAsset } from '../../contracts/claude-assets.ts';

const AGENT = [
  '---',
  'name: german-ui-expert',
  'description: German label, screenshot or ticket to i18n source string and component.',
  'tools: Read, Grep, Glob',
  'maxTurns: 20',
  'model: inherit',
  '---',
  '',
  'You are the **German UI expert**.',
].join('\n');

const COMMAND = [
  '---',
  'description: Pre-MR DESIGN-FIT pass on a visual change.',
  'argument-hint: "<route or surface> [--ref=<reference route/selector>]"',
  'allowed-tools: Read, Grep, Glob, Bash, Agent',
  '---',
  '',
  '## Why this exists',
].join('\n');

describe('parseAsset', () => {
  it('reads the four fields a roster draws', () => {
    expect(parseAsset('agent', 'german-ui-expert', AGENT)).toEqual({
      kind: 'agent',
      name: 'german-ui-expert',
      description: 'German label, screenshot or ticket to i18n source string and component.',
      model: 'inherit',
      tools: ['Read', 'Grep', 'Glob'],
    });
  });

  it('falls back to the filename, because Claude Code addresses a command by it', () => {
    // 12 of the 19 measured files carry `argument-hint` and only 16 carry `name` — a command with
    // no `name:` is still `/design-check`, and dropping it would hide a command that works.
    const command = parseAsset('command', 'design-check', COMMAND);
    expect(command?.name).toBe('design-check');
    expect(command?.model).toBeUndefined();
  });

  it('reads `allowed-tools` where an agent writes `tools`', () => {
    expect(parseAsset('command', 'design-check', COMMAND)?.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Bash',
      'Agent',
    ]);
  });

  it('strips the quotes a hint is written with', () => {
    const quoted = ['---', 'name: "fix-review"', "description: 'one fetch, one commit'", '---'];
    expect(parseAsset('skill', 'fix-review', quoted.join('\n'))?.description).toBe(
      'one fetch, one commit',
    );
  });

  it('refuses a file with no frontmatter — Claude Code would not load it either', () => {
    expect(parseAsset('agent', 'readme', '# Just a heading\n')).toBeUndefined();
    expect(parseAsset('agent', 'readme', undefined)).toBeUndefined();
  });

  it('stops at the closing fence, so the body cannot supply a field', () => {
    const body = ['---', 'name: real', '---', '', 'description: not a field', ''].join('\n');
    expect(parseAsset('agent', 'real', body)?.description).toBeUndefined();
  });

  it('ignores an indented line, which is a nested map this parser does not read', () => {
    const nested = ['---', 'name: outer', 'metadata:', '  name: inner', '---'].join('\n');
    expect(parseAsset('agent', 'file', nested)?.name).toBe('outer');
  });

  it('parses a head that was truncated before its closing fence', () => {
    // A 4 KB read of a file whose block is longer. The lines that arrived are the ones that matter.
    const cut = ['---', 'name: long-one', 'description: it goes on'].join('\n');
    expect(parseAsset('skill', 'long-one', cut)?.name).toBe('long-one');
  });
});

describe('parseClaudeAsset', () => {
  it('drops a kind this build does not know', () => {
    expect(parseClaudeAsset({ kind: 'plugin', name: 'x' })).toBeUndefined();
  });

  it('drops an entry with no name', () => {
    expect(parseClaudeAsset({ kind: 'agent', name: '' })).toBeUndefined();
    expect(parseClaudeAsset('agent')).toBeUndefined();
  });

  it('keeps the strings in a tools array and nothing else', () => {
    const asset = parseClaudeAsset({ kind: 'skill', name: 's', tools: ['Read', 7, '', 'Bash'] });
    expect(asset?.tools).toEqual(['Read', 'Bash']);
  });
});

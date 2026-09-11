// The scrubber is the only thing standing between a raw capture and the repo, and the repo is
// public (DECISIONS.md D23). These tests pin the rules CODING-STANDARDS.md §10.3 states.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper script, no type declarations by design.
import { scrub } from '../scripts/capture-fixtures.mjs';

const scrubValue = scrub as (node: unknown, key?: string) => unknown;

describe('capture-fixtures scrub', () => {
  it('leaves strings of 12 characters or fewer alone', () => {
    expect(scrubValue({ hook_event_name: 'Stop', source: 'startup' })).toEqual({
      hook_event_name: 'Stop',
      source: 'startup',
    });
  });

  it('replaces a long free-text string', () => {
    const result = scrubValue({ last_assistant_message: 'a sentence well over the limit' }) as {
      last_assistant_message: string;
    };
    expect(result.last_assistant_message).not.toContain('sentence');
    expect(result.last_assistant_message).toMatch(/^text-[0-9a-f]{8}$/);
  });

  it('keeps a scrubbed session id a well-formed v4 uuid, so contracts/ schemas still accept it', () => {
    const result = scrubValue({ session_id: 'cd1534c8-c7f0-488f-8da7-66c7aba3e7e5' }) as {
      session_id: string;
    };
    expect(result.session_id).not.toBe('cd1534c8-c7f0-488f-8da7-66c7aba3e7e5');
    expect(result.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('keeps a scrubbed path a Windows path of the same depth and extension', () => {
    const original = 'C:\\Users\\dev\\.claude-isg\\projects\\a-very-long-project-slug\\x.jsonl';
    const result = scrubValue({ transcript_path: original }) as { transcript_path: string };
    expect(result.transcript_path).not.toContain('a-very-long-project-slug');
    expect(result.transcript_path.split('\\')).toHaveLength(original.split('\\').length);
    expect(result.transcript_path.endsWith('.jsonl')).toBe(true);
  });

  it('is deterministic — the same input always yields the same placeholder', () => {
    const input = { session_id: 'cd1534c8-c7f0-488f-8da7-66c7aba3e7e5' };
    expect(scrubValue(input)).toEqual(scrubValue(input));
  });

  it('keeps enum-like vocabulary readable but scrubs an implausibly long value', () => {
    expect(scrubValue({ model: 'claude-haiku-4-5' })).toEqual({ model: 'claude-haiku-4-5' });
    const long = 'x'.repeat(120);
    expect((scrubValue({ model: long }) as { model: string }).model).toMatch(/^text-/);
  });

  // F.7.8: the length rule used to apply to path segments too, so the machine account name and
  // every project folder — all under 12 characters — were published in every committed fixture.
  it('scrubs a short path segment that identifies the machine or its projects', () => {
    const original = 'C:\\Users\\jdoe\\Documents\\development\\acme-crm';
    const result = scrubValue({ cwd: original }) as { cwd: string };
    expect(result.cwd).not.toContain('jdoe');
    expect(result.cwd).not.toContain('acme-crm');
    expect(result.cwd).toMatch(/^C:\\Users\\path-[0-9a-f]{6}\\Documents\\/);
  });

  it('keeps the structural segments a parser navigates by', () => {
    const result = scrubValue({
      transcript_path: 'C:\\Users\\jdoe\\.claude-isg\\projects\\slug\\x.jsonl',
    }) as { transcript_path: string };
    expect(result.transcript_path).toContain('\\Users\\');
    expect(result.transcript_path).toContain('\\.claude-isg\\projects\\');
  });

  it('scrubs a session name however short, because a ticket id is a name', () => {
    const result = scrubValue({ pid: 1, name: 'ACME-42' }) as { name: string };
    expect(result.name).not.toBe('ACME-42');
    expect(result.name).toMatch(/^text-[0-9a-f]{8}$/);
  });

  it('leaves a vocabulary name alone — only session records have free-text names', () => {
    expect(scrubValue({ output_style: { name: 'default' } })).toEqual({
      output_style: { name: 'default' },
    });
  });

  it('scrubs inside arrays and nested objects', () => {
    const result = scrubValue({
      background_tasks: [{ transcript_path: 'C:\\Users\\dev\\some-long-directory\\a.jsonl' }],
    }) as { background_tasks: { transcript_path: string }[] };
    expect(result.background_tasks[0]?.transcript_path).not.toContain('some-long-directory');
  });
});

// Added in P0-T4: three shapes the scrubber used to flatten into `text-…`, which made the
// agents and jobs fixtures unable to test the very things they were captured for.
describe('capture-fixtures scrub — shapes preserved for P0-T4 fixtures', () => {
  it('keeps a timestamp parseable while hiding when it happened', () => {
    const result = scrubValue({ createdAt: '2026-09-10T19:32:44.652Z' }) as { createdAt: string };
    expect(result.createdAt).not.toBe('2026-09-10T19:32:44.652Z');
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
  });

  it('keeps instants in order and the gaps between them, so a timeline fixture still reads', () => {
    const result = scrubValue({
      entries: [{ at: '2026-09-10T19:34:11.183Z' }, { at: '2026-09-10T19:34:25.200Z' }],
    }) as { entries: { at: string }[] };
    const [first, second] = result.entries;

    expect(Date.parse(String(second?.at)) - Date.parse(String(first?.at))).toBe(14_017);
  });

  it('keeps CLI flag names readable but still scrubs their values', () => {
    const result = scrubValue({
      respawnFlags: ['--permission-mode', 'default', 'a prompt that is long enough to scrub'],
    }) as { respawnFlags: string[] };
    expect(result.respawnFlags[0]).toBe('--permission-mode');
    expect(result.respawnFlags[1]).toBe('default');
    expect(result.respawnFlags[2]).toMatch(/^text-/);
  });

  it('keeps the short id derivable from the scrubbed session id', () => {
    const result = scrubValue({
      id: '6b113e49',
      sessionId: '6b113e49-b362-4448-8122-9aef63ce6188',
    }) as { id: string; sessionId: string };
    expect(result.sessionId).not.toContain('6b113e49');
    expect(result.sessionId.startsWith(result.id)).toBe(true);
    expect(result.id).toHaveLength(8);
  });

  it('leaves an unrelated id alone when it is not a prefix of the session id', () => {
    const result = scrubValue({
      id: 'abcdef12',
      sessionId: '6b113e49-b362-4448-8122-9aef63ce6188',
    });
    expect((result as { id: string }).id).toBe('abcdef12');
  });
});

describe('capture-fixtures scrub — roster workers are keyed by data, not by field name', () => {
  type Workers = Record<string, { sessionId?: string; pid?: number }>;

  function scrubWorkers(workers: Workers): Workers {
    return (scrubValue({ workers }) as { workers: Workers }).workers;
  }

  it('rewrites the worker key to track its scrubbed sessionId', () => {
    const scrubbed = scrubWorkers({
      '020e5c73': { sessionId: '020e5c73-aea4-45b5-9561-0ade34ac96fe', pid: 14572 },
    });
    const entries = Object.entries(scrubbed);
    const [id, worker] = entries[0] ?? ['', {}];
    expect(id).not.toBe('020e5c73');
    expect(worker.sessionId).not.toBe('020e5c73-aea4-45b5-9561-0ade34ac96fe');
    // The relationship the fixture exists to assert: the key is the session id's first segment.
    expect(worker.sessionId?.startsWith(id)).toBe(true);
  });

  it('leaves a worker key alone when there is no sessionId to derive it from', () => {
    expect(Object.keys(scrubWorkers({ '020e5c73': { pid: 1 } }))).toEqual(['020e5c73']);
  });

  it('does not rewrite keys of ordinary objects', () => {
    const scrubbed = scrubValue({ usage: { sessionId: 'a'.repeat(40) } }) as {
      usage: Record<string, unknown>;
    };
    expect(Object.keys(scrubbed.usage)).toEqual(['sessionId']);
  });
});

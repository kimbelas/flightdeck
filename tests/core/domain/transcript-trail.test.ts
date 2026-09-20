// The transcript half of a preview — P5a-T4.
//
// The assertions that matter are about what the trail REFUSES to show as much as what it shows:
// the record projection in contracts/transcript-record.ts is a security boundary (SEC-DATA-1,
// "what is never read cannot leak"), and a trail that reached past it for conversation text would
// widen the largest body of model prose in the product for a fallback view.
import { describe, expect, it } from 'vitest';
import { MAX_TRAIL_ROWS, trailOf } from '../../../core/domain/transcript-trail.ts';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');

function at(secondsAgo: number): string {
  return new Date(NOW - secondsAgo * 1000).toISOString();
}

function tool(name: string, secondsAgo: number): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at(secondsAgo),
    message: { content: [{ type: 'tool_use', name }] },
  });
}

describe('trailOf', () => {
  it('renders a tool record as an age, a kind and the tool', () => {
    const lines = trailOf(tool('Bash', 90), NOW);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2m ago');
    expect(lines[0]).toContain('tool');
    expect(lines[0]).toContain('Bash');
  });

  it('keeps file order, oldest first — a trail is about sequence', () => {
    const lines = trailOf([tool('Read', 300), tool('Edit', 60)].join('\n'), NOW);

    expect(lines[0]).toContain('Read');
    expect(lines[1]).toContain('Edit');
  });

  it('shows the records this build already parses, and only those', () => {
    const text = [
      JSON.stringify({ type: 'file-history-delta', trackingPath: 'src\\a.ts', timestamp: at(10) }),
      JSON.stringify({
        type: 'system',
        subtype: 'turn_duration',
        durationMs: 42_000,
        messageCount: 6,
        timestamp: at(5),
      }),
      JSON.stringify({ type: 'system', subtype: 'away_summary', content: 'fixed the parser' }),
    ].join('\n');

    const lines = trailOf(text, NOW);

    expect(lines[0]).toContain('src\\a.ts');
    expect(lines[1]).toContain('6 messages in 42s');
    expect(lines[2]).toContain('fixed the parser');
  });

  it('shows nothing for the 95 % of a transcript this build does not read', () => {
    const text = [
      JSON.stringify({ type: 'user', message: { content: 'a long pasted file' } }),
      JSON.stringify({ type: 'attachment', content: 'more of it' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    ].join('\n');

    // The third line is the one worth naming: it IS an assistant turn, with prose in it, and the
    // trail does not reach for it (SEC-DATA-1).
    expect(trailOf(text, NOW)).toEqual([]);
  });

  it('drops title, agent, cost and the prompt — all four are already on the row', () => {
    const text = [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Parser work' }),
      JSON.stringify({ type: 'agent-name', agentName: 'reviewer' }),
      JSON.stringify({ type: 'cost-state', costUsd: 1, linesAdded: 2, linesRemoved: 3 }),
      // The prompt joined them after this was run for real (RESEARCH.md G.37): Claude Code
      // REWRITES `last-prompt` every turn rather than appending, so a tail holds one copy per turn
      // and the same 140 characters landed on seven of twenty-four rows — non-consecutively, where
      // the run-length collapse cannot reach them.
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'do the thing' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'do the thing' }),
    ].join('\n');

    expect(trailOf(text, NOW)).toEqual([]);
  });

  it('gives a record with no instant a row and no age, rather than a guessed one', () => {
    // An away summary with no `timestamp`. Real: not every writer sets one, and a made-up age on a
    // trail whose whole value is sequence would be the one lie worth avoiding here.
    const text = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      content: 'did a thing',
    });

    const lines = trailOf(text, NOW);

    expect(lines[0]).toContain('did a thing');
    expect(lines[0]).not.toMatch(/ago/);
  });

  it('flattens a multi-line summary to one row', () => {
    const text = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      content: 'first thing\n\nsecond thing',
      timestamp: at(30),
    });

    const lines = trailOf(text, NOW);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('first thing second thing');
  });

  it('clips a row rather than letting one record wrap the whole box', () => {
    const text = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      content: 'x'.repeat(4000),
      timestamp: at(30),
    });

    expect(trailOf(text, NOW)[0]?.length).toBeLessThan(200);
  });

  it('keeps the NEWEST rows when there are more than fit', () => {
    const text = Array.from({ length: MAX_TRAIL_ROWS + 5 }, (unused, index) =>
      tool(`Tool${String(index)}`, 100 - index),
    ).join('\n');

    const lines = trailOf(text, NOW);

    expect(lines).toHaveLength(MAX_TRAIL_ROWS);
    expect(lines.at(-1)).toContain(`Tool${String(MAX_TRAIL_ROWS + 4)}`);
  });

  it('collapses a run of identical rows to one with a count', () => {
    // Found by running it (RESEARCH.md G.37): an agentic turn reaches for the same tool several
    // times and the age is in whole minutes, so the rows render identically — this session's own
    // trail came back as twenty-four rows saying about six things. A count rather than a
    // de-duplication, because those ARE separate calls and dropping them would say the session did
    // less than it did.
    const edits = [tool('Edit', 20), tool('Edit', 20), tool('Edit', 20)];
    const lines = trailOf([...edits, tool('Bash', 10)].join('\n'), NOW);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('x3');
    expect(lines[1]).toContain('Bash');
  });

  it('counts only CONSECUTIVE repeats, so a row that comes back later is its own line', () => {
    const lines = trailOf([tool('Edit', 20), tool('Bash', 10), tool('Edit', 20)].join('\n'), NOW);

    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.includes(' x'))).toEqual([]);
  });

  it('leaves a single row uncounted — `x1` would be noise on every line', () => {
    expect(trailOf(tool('Bash', 10), NOW)[0]).not.toContain('x1');
  });

  it('caps AFTER collapsing, so a wall of repeats does not push out what came before it', () => {
    const repeats = Array.from({ length: MAX_TRAIL_ROWS + 20 }, () => tool('Edit', 20));
    const lines = trailOf([tool('Read', 600), ...repeats, tool('Bash', 10)].join('\n'), NOW);

    // The `Read` is what makes this test discriminate, and the first version of it had no `Read`:
    // capping first also left the `Bash` in place, so it passed against both orders and proved
    // nothing (RESEARCH.md G.32). Capping first drops the `Read`, because the wall of repeats is
    // longer than the cap — and on a real transcript the wall is the norm, not the edge case.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Read');
    expect(lines[1]).toContain(`x${String(MAX_TRAIL_ROWS + 20)}`);
    expect(lines[2]).toContain('Bash');
  });

  it('skips a line that is not JSON, exactly as the tail does', () => {
    expect(trailOf(`{half a record\n${tool('Bash', 10)}`, NOW)).toHaveLength(1);
  });

  it('reads an instant in the future as now rather than as a negative age', () => {
    expect(trailOf(tool('Bash', -600), NOW)[0]).toContain('0s ago');
  });

  it('scales the age as it grows, so a trail of a long session stays readable', () => {
    const ages = [30, 60 * 5, 60 * 60 * 3, 60 * 60 * 24 * 4].map(
      (seconds) => trailOf(tool('Bash', seconds), NOW)[0] ?? '',
    );

    expect(ages[0]).toContain('30s ago');
    expect(ages[1]).toContain('5m ago');
    expect(ages[2]).toContain('3h ago');
    expect(ages[3]).toContain('4d ago');
  });
});

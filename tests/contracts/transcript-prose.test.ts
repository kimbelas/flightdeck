// What goes into the search index, and what deliberately does not — P7-T1, SEC-DATA-1.
//
// Two questions, and the second is the one worth the file. The first is "does a turn come out at
// all". The second is **"what did NOT come out"**: this reader decides which of the owner's words
// are copied out of a transcript and into a database that is never deleted, and the answer measured
// over this machine's corpus is 1.7 % of the bytes. A reader that quietly took the other 98 %
// would store every pasted file and every tool result, which is precisely the sensitivity
// SEC-DATA-1 is written about.
import { describe, expect, it } from 'vitest';
import { MAX_EXCERPT_CHARS, readTranscriptProse } from '../../contracts/transcript-prose.ts';

const AT = '2026-09-21T10:00:00.000Z';

describe('readTranscriptProse — what it reads', () => {
  it('reads a turn somebody typed', () => {
    const prose = readTranscriptProse({
      type: 'user',
      timestamp: AT,
      message: { content: 'deploy this to cloudflare workers' },
    });

    expect(prose).toEqual({
      kind: 'you',
      text: 'deploy this to cloudflare workers',
      at: Date.parse(AT),
    });
  });

  it('reads what Claude said', () => {
    const prose = readTranscriptProse({
      type: 'assistant',
      timestamp: AT,
      message: { content: [{ type: 'text', text: 'Deployed to Cloudflare Workers.' }] },
    });

    expect(prose).toMatchObject({ kind: 'claude', text: 'Deployed to Cloudflare Workers.' });
  });

  // Two blocks are two paragraphs. Running them together would make a snippet read as one
  // sentence that was never written.
  it('joins several text blocks as paragraphs rather than concatenating them', () => {
    const prose = readTranscriptProse({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First.' },
          { type: 'text', text: 'Second.' },
        ],
      },
    });

    expect(prose?.text).toBe('First.\n\nSecond.');
  });

  it.each(['ai-title', 'custom-title'])('reads a %s', (type) => {
    expect(readTranscriptProse({ type, title: 'Cloudflare deploy' })).toMatchObject({
      kind: 'title',
      text: 'Cloudflare deploy',
    });
  });

  it('reads an away summary, which is what a session did while nobody watched', () => {
    const prose = readTranscriptProse({
      type: 'system',
      subtype: 'away_summary',
      content: 'Deployed the worker and fixed the route.',
    });

    expect(prose).toMatchObject({ kind: 'away' });
  });
});

describe('readTranscriptProse — what it refuses to read', () => {
  /**
   * The case that decides how big the index is.
   *
   * `message.content` is an ARRAY on a `user` record when a tool result is being fed back, and
   * those are the bulk of the `user` records in any transcript — 19 294 of them in one file
   * P1-T7 surveyed. Only the string form is a person talking.
   */
  it('does not read a tool result fed back as a user record', () => {
    const prose = readTranscriptProse({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'a thousand lines of output' }] },
    });

    expect(prose).toBeUndefined();
  });

  /**
   * A `thinking` block carries a `text` field too.
   *
   * So "has text on it" is not the test and never was — the block's own `type` is. Reasoning is not
   * something the owner or Claude SAID, and putting it in a database that is never deleted is a
   * decision nobody made (SEC-DATA-1).
   */
  it('does not read a thinking block, which has a text field of its own', () => {
    const prose = readTranscriptProse({
      type: 'assistant',
      message: { content: [{ type: 'thinking', text: 'weighing two options' }] },
    });

    expect(prose).toBeUndefined();
  });

  it('reads the text blocks beside a thinking one, and only those', () => {
    const prose = readTranscriptProse({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', text: 'weighing two options' },
          { type: 'text', text: 'Deployed.' },
        ],
      },
    });

    expect(prose?.text).toBe('Deployed.');
  });

  it('does not read a tool call, which is not prose', () => {
    const prose = readTranscriptProse({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    });

    expect(prose).toBeUndefined();
  });

  it.each([
    { line: { type: 'cost-state', costUSD: 1 }, why: 'a cost line' },
    { line: { type: 'file-history-delta', trackingPath: 'C:\\x' }, why: 'a file record' },
    { line: { type: 'last-prompt', lastPrompt: 'hello' }, why: 'the last-prompt record' },
    { line: { type: 'system', subtype: 'scheduled_task_fire' }, why: 'another system subtype' },
    { line: { type: 'something-new' }, why: 'a type this build has never seen' },
  ])('does not read $why', ({ line }) => {
    expect(readTranscriptProse(line)).toBeUndefined();
  });

  // `last-prompt` carries the session's MOST RECENT prompt and is re-written as the session goes,
  // so indexing it would give one turn per session and call it the conversation. The `user`
  // records are the conversation.
  it('reads the user turns rather than the last-prompt record', () => {
    expect(readTranscriptProse({ type: 'last-prompt', lastPrompt: 'deploy' })).toBeUndefined();
    expect(readTranscriptProse({ type: 'user', message: { content: 'deploy' } })).toBeDefined();
  });

  it.each([undefined, null, 42, 'a string', [], { noType: true }])(
    'answers undefined for %s rather than throwing',
    (value) => {
      expect(readTranscriptProse(value)).toBeUndefined();
    },
  );

  it('produces nothing for a turn that is only whitespace', () => {
    expect(readTranscriptProse({ type: 'user', message: { content: '   \n  ' } })).toBeUndefined();
  });
});

describe('readTranscriptProse — the cap', () => {
  // The largest `user` line P1-T7 measured is 3 230 728 bytes, and it is a pasted file rather than
  // a sentence. FTS5 matches on tokens, so the first 8 KB finds the turn; keeping the rest would
  // put a file the owner pasted in into a database that is never deleted (SEC-DATA-1).
  it('keeps the first 8 KB of a turn and no more', () => {
    const huge = 'x'.repeat(3_000_000);

    const prose = readTranscriptProse({ type: 'user', message: { content: huge } });

    expect(prose?.text.length).toBe(MAX_EXCERPT_CHARS);
  });

  it('trims, so a turn does not carry the newline it was written with', () => {
    const prose = readTranscriptProse({ type: 'user', message: { content: '  hello\n' } });

    expect(prose?.text).toBe('hello');
  });
});

describe('readTranscriptProse — when it was said', () => {
  it('reads the ISO timestamp as epoch ms', () => {
    const prose = readTranscriptProse({ type: 'user', timestamp: AT, message: { content: 'x' } });

    expect(prose?.at).toBe(Date.parse(AT));
  });

  // A record with no instant is ordinary rather than broken, and `undefined` says so — the store
  // turns it into 0 so that it sorts below everything that has one.
  it.each([undefined, '', 'not a date', 12345])('answers undefined for %s', (timestamp) => {
    const prose = readTranscriptProse({ type: 'user', timestamp, message: { content: 'x' } });

    expect(prose?.at).toBeUndefined();
  });
});

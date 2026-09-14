// The byte offset, the partial-line buffer and truncation detection — P1-T7.
import { describe, expect, it } from 'vitest';
import { MAX_LINE_CHARS, TranscriptTail } from '../../../core/application/transcript-tail.ts';
import type { TranscriptSlice } from '../../../core/ports/transcript-file.ts';

function slice(text: string, over: Partial<TranscriptSlice> = {}): TranscriptSlice {
  return {
    text,
    from: 0,
    to: Buffer.byteLength(text),
    identity: 'file:1',
    restarted: false,
    unreadable: false,
    ...over,
  };
}

const TITLE = '{"type":"ai-title","aiTitle":"a title","sessionId":"s"}';
const PROMPT = '{"type":"last-prompt","lastPrompt":"do the thing","sessionId":"s"}';

describe('TranscriptTail — lines', () => {
  it('reads whole lines and carries the byte offset forward', () => {
    const tail = new TranscriptTail();

    const batch = tail.absorb(slice(`${TITLE}\n${PROMPT}\n`, { to: 120 }));

    expect(batch.records.map((record) => record.kind)).toEqual(['title', 'prompt']);
    expect(tail.at).toEqual({ offset: 120, identity: 'file:1' });
  });

  it('holds an unterminated line back until its newline arrives', () => {
    const tail = new TranscriptTail();
    const half = TITLE.slice(0, 20);

    const first = tail.absorb(slice(half));
    const second = tail.absorb(slice(`${TITLE.slice(20)}\n`));

    // The half line produced nothing and was not counted as a broken record — it was not a record
    // yet. Parsing it would have been an unparseable line blamed on a schema change.
    expect(first.records).toEqual([]);
    expect(first.unknown).toBe(0);
    expect(second.records).toHaveLength(1);
  });

  it('assembles a line that arrives in many slices', () => {
    const tail = new TranscriptTail();
    const whole = `${TITLE}\n`;
    for (const char of whole.slice(0, -1)) tail.absorb(slice(char));

    const last = tail.absorb(slice('\n'));

    expect(last.records).toHaveLength(1);
  });

  it('counts a blank line as nothing at all', () => {
    const tail = new TranscriptTail();

    const batch = tail.absorb(slice(`\n\n${TITLE}\n`));

    expect(batch.records).toHaveLength(1);
    expect(batch.ignored).toBe(0);
    expect(batch.unknown).toBe(0);
  });
});

describe('TranscriptTail — what it cannot name', () => {
  it('separates a record type it ignores from one it has never seen', () => {
    const tail = new TranscriptTail();

    const batch = tail.absorb(
      slice('{"type":"attachment"}\n{"type":"something-new-in-2.2"}\n{"type":"user"}\n'),
    );

    // The distinction is the whole point: `user` and `attachment` are 40 % of a real transcript,
    // so counting them as drift would make the drift number useless (SPEC §8 R2).
    expect(batch.ignored).toBe(2);
    expect(batch.unknown).toBe(1);
    expect(batch.records).toEqual([]);
  });

  it('treats an unseen system subtype as drift, because system is a bag and not a shape', () => {
    const tail = new TranscriptTail();

    const batch = tail.absorb(
      slice(
        '{"type":"system","subtype":"turn_duration","durationMs":5,"messageCount":1}\n' +
          '{"type":"system","subtype":"brand_new_thing"}\n',
      ),
    );

    expect(batch.records).toHaveLength(1);
    expect(batch.unknown).toBe(1);
  });

  it('never throws on a line that is not JSON, and counts it as drift', () => {
    const tail = new TranscriptTail();

    const batch = tail.absorb(slice('not json at all\n{"type":"user"}\n'));

    expect(batch.unknown).toBe(1);
    expect(batch.ignored).toBe(1);
  });
});

describe('TranscriptTail — the cap', () => {
  it('drops a line over the cap and resynchronises on the next one', () => {
    const tail = new TranscriptTail();
    const huge = `{"type":"user","message":"${'x'.repeat(MAX_LINE_CHARS)}"}`;

    const batch = tail.absorb(slice(`${huge}\n${TITLE}\n`));

    expect(batch.oversize).toBe(1);
    expect(batch.records.map((record) => record.kind)).toEqual(['title']);
  });

  it('refuses to grow the buffer past the cap while the line is still arriving', () => {
    const tail = new TranscriptTail();
    const chunk = 'x'.repeat(MAX_LINE_CHARS / 2);

    tail.absorb(slice(`{"type":"user","m":"${chunk}`));
    const second = tail.absorb(slice(chunk));
    const third = tail.absorb(slice(`${chunk}"}\n${TITLE}\n`));

    // The point of checking on the partial as well as on the whole line: a 3 MB record that never
    // terminates inside one slice would otherwise be held in full before the cap was consulted.
    expect(second.oversize).toBe(1);
    expect(third.records.map((record) => record.kind)).toEqual(['title']);
  });
});

describe('TranscriptTail — truncation', () => {
  it('forgets the partial line when the file restarts, and says so', () => {
    const tail = new TranscriptTail();
    tail.absorb(slice(TITLE.slice(0, 20)));

    const batch = tail.absorb(
      slice(`${PROMPT}\n`, { restarted: true, from: 0, identity: 'file:2' }),
    );

    // Without the reset, the orphaned half of the old title would be glued to the front of the
    // first line of the new file and both records would be lost to one unparseable seam.
    expect(batch.restarted).toBe(true);
    expect(batch.records.map((record) => record.kind)).toEqual(['prompt']);
    expect(tail.restarts).toBe(1);
  });

  it('keeps the counters across a restart, because they are about the format, not the file', () => {
    const tail = new TranscriptTail();
    tail.absorb(slice('{"type":"brand-new"}\n'));

    const batch = tail.absorb(slice(`${TITLE}\n`, { restarted: true, identity: 'file:2' }));

    expect(batch.unknown).toBe(1);
  });

  it('keeps the cursor when a read fails, so a missing transcript costs no progress', () => {
    const tail = new TranscriptTail();
    tail.absorb(slice(`${TITLE}\n`, { to: 55 }));

    const batch = tail.absorb(slice('', { unreadable: true, to: 0, identity: '' }));

    expect(batch.records).toEqual([]);
    expect(tail.at).toEqual({ offset: 55, identity: 'file:1' });
  });
});

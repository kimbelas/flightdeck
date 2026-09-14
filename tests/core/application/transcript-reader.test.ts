// Feed 4 end to end against fakes — P1-T7.
import { describe, expect, it } from 'vitest';
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import { TranscriptReader } from '../../../core/application/transcript-reader.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeTranscriptFile } from '../../fakes/fake-transcript-file.ts';

const PATH = 'C:\\Users\\x\\.claude-365\\projects\\slug\\session.jsonl';
const SESSION = '11111111-2222-4333-a444-555555555555';

function build(): {
  reader: TranscriptReader;
  file: FakeTranscriptFile;
  scheduler: FakeScheduler;
  logger: FakeLogger;
} {
  const file = new FakeTranscriptFile();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  return { reader: new TranscriptReader({ file, scheduler, logger }), file, scheduler, logger };
}

function hook(payload: unknown, sessionId = SESSION): DraftEvent {
  return { at: 1, sessionId, subscription: '365', source: 'hook', type: 'Stop', payload };
}

const TITLE = '{"type":"ai-title","aiTitle":"a title","sessionId":"s"}\n';
const AWAY = '{"type":"system","subtype":"away_summary","content":"a recap"}\n';

describe('TranscriptReader — learning which files to read', () => {
  it('learns a transcript path off a hook event going past', () => {
    const { reader } = build();

    reader.publish(hook({ transcript_path: PATH }));

    expect(reader.size).toBe(1);
  });

  it('learns the statusLine projection spelling too', () => {
    const { reader } = build();

    reader.publish({ ...hook({ transcriptPath: PATH }), source: 'statusline' });

    expect(reader.size).toBe(1);
  });

  it('ignores events from feeds that do not carry a transcript, and its own kind', () => {
    const { reader } = build();

    reader.publish({ ...hook({ transcript_path: PATH }), source: 'reconcile' });
    reader.publish({ ...hook({ transcript_path: PATH }), source: 'transcript' });

    expect(reader.size).toBe(0);
  });

  it('never throws on a payload that is not what it hoped for', () => {
    const { reader } = build();

    for (const payload of [undefined, null, 42, 'text', [], { transcript_path: 7 }, {}]) {
      expect(() => {
        reader.publish(hook(payload));
      }).not.toThrow();
    }
    expect(reader.size).toBe(0);
  });
});

describe('TranscriptReader — reading', () => {
  it('folds what it reads into a digest for the session', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE + AWAY);
    reader.publish(hook({ transcript_path: PATH }));

    await reader.poll();

    expect(reader.get(SESSION)?.digest.title).toBe('a title');
    expect(reader.get(SESSION)?.digest.awaySummary).toBe('a recap');
  });

  it('reads only what was appended since the last poll', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE);
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    file.append(PATH, AWAY);
    await reader.poll();

    // The byte offset is the whole point: a 50 MB transcript polled every second must not be a
    // 50 MB read every second (SPEC §8 R6).
    expect(reader.get(SESSION)?.digest.title).toBe('a title');
    expect(reader.get(SESSION)?.digest.awaySummary).toBe('a recap');
  });

  it('drops the digest when the transcript is replaced under it', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE + AWAY);
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    file.replace(PATH, '{"type":"ai-title","aiTitle":"resumed","sessionId":"s"}\n');
    await reader.poll();

    // A resumed session must not show its predecessor's recap — the bytes it came from are gone.
    expect(reader.get(SESSION)?.digest.title).toBe('resumed');
    expect(reader.get(SESSION)?.digest.awaySummary).toBeUndefined();
  });

  it('survives a transcript that is truncated without being replaced', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE + AWAY);
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    file.truncate(PATH, 10);
    await reader.poll();

    expect(reader.get(SESSION)?.digest.isEmpty).toBe(true);
  });

  it('keeps the digest when a read fails, because a missing file is an ordinary state', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE);
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    file.makeUnreadable(PATH);
    await reader.poll();

    expect(reader.get(SESSION)?.digest.title).toBe('a title');
  });

  it('starts a new tail when the same session reports a different transcript path', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE);
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    const moved = 'C:\\Users\\x\\.claude-365\\projects\\slug\\other.jsonl';
    file.append(moved, AWAY);
    reader.publish(hook({ transcript_path: moved }));
    await reader.poll();

    expect(reader.size).toBe(1);
    expect(reader.get(SESSION)?.digest.awaySummary).toBe('a recap');
    expect(reader.get(SESSION)?.digest.title).toBeUndefined();
  });

  it('assembles a record that the reader is handed in pieces', async () => {
    const { reader, file } = build();
    file.append(PATH, TITLE);
    file.sliceLimit = 7;
    reader.publish(hook({ transcript_path: PATH }));

    for (let poll = 0; poll < 20; poll += 1) await reader.poll();

    expect(reader.get(SESSION)?.digest.title).toBe('a title');
  });
});

describe('TranscriptReader — the poll', () => {
  it('runs on the scheduler once started and stops cleanly', async () => {
    const { reader, file, scheduler } = build();
    file.append(PATH, TITLE);
    reader.publish(hook({ transcript_path: PATH }));

    reader.start();
    scheduler.tick();
    await Promise.resolve();

    expect(file.reads).toBeGreaterThan(0);
    expect(scheduler.repeatingCount).toBe(1);

    reader.stop();
    const after = file.reads;
    scheduler.tick();

    // A timer nobody cancelled is what keeps core alive after Ctrl+C — the reason `NodeScheduler`
    // deliberately does not `unref` and the reason `stopCore` has an order (main.ts).
    expect(scheduler.repeatingCount).toBe(0);
    expect(file.reads).toBe(after);
  });

  it('warns once when a record type nobody has seen turns up, and not on ordinary lines', async () => {
    const { reader, file, logger } = build();
    file.append(PATH, '{"type":"user"}\n{"type":"attachment"}\n');
    reader.publish(hook({ transcript_path: PATH }));
    await reader.poll();

    expect(logger.at('warn')).toHaveLength(0);

    file.append(PATH, '{"type":"invented-in-2.2"}\n');
    await reader.poll();
    await reader.poll();

    // Once, on the poll that saw it — not on every poll thereafter, which a 1 Hz timer would
    // turn into a log nobody reads.
    expect(logger.at('warn')).toHaveLength(1);
  });
});

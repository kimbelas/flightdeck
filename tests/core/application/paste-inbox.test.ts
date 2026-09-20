// P5a-T8. Two behaviours belong to this class and nothing else: what the file is called, and how
// many survive. Both are asserted here rather than through the route, because neither needs one.
import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PasteInbox } from '../../../core/application/paste-inbox.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakePastedImageStore } from '../../fakes/fake-pasted-image-store.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);

function inbox(clock = new FakeClock()): {
  inbox: PasteInbox;
  store: FakePastedImageStore;
  logger: FakeLogger;
  clock: FakeClock;
} {
  const store = new FakePastedImageStore();
  const logger = new FakeLogger();
  return { inbox: new PasteInbox({ store, clock, logger }), store, logger, clock };
}

describe('PasteInbox.accept', () => {
  it('writes the image and answers with the path the store used', async () => {
    const { inbox: subject, store } = inbox();
    const written = await subject.accept('png', PNG);

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toBe(
      win32.join(FakePastedImageStore.DIRECTORY, String(store.written[0])),
    );
    expect(store.bytesOf(String(store.written[0]))).toEqual(PNG);
  });

  it('names the file itself, out of digits and the extension for the kind', async () => {
    const { inbox: subject, store } = inbox(new FakeClock(Date.parse('2026-09-20T14:33:55.123Z')));
    await subject.accept('gif', GIF);

    // Local time, so the digits are not asserted — what is asserted is the SHAPE, because the
    // shape is the control: nothing from the wire may appear in a name that is about to be typed
    // at a shell (SEC-FS-5).
    expect(store.written[0]).toMatch(/^paste-\d{8}-\d{6}-\d{3}-\d{4}\.gif$/u);
  });

  it('never writes the same name twice inside one millisecond', async () => {
    const { inbox: subject, store } = inbox();
    for (let index = 0; index < 5; index += 1) await subject.accept('png', PNG);

    expect(new Set(store.written).size).toBe(5);
    // Sorted, because the retention cap compares them as strings and nothing stats a file.
    expect([...store.written].sort()).toEqual(store.written);
  });

  it('passes the domain refusal back and writes nothing', async () => {
    const { inbox: subject, store } = inbox();

    expect(await subject.accept('png', GIF)).toEqual({ ok: false, error: 'not_that_kind' });
    expect(await subject.accept('bmp', PNG)).toEqual({ ok: false, error: 'unknown_kind' });
    expect(store.written).toEqual([]);
  });

  it('keeps 64 images and drops the oldest past that', async () => {
    const { inbox: subject, store, clock } = inbox();
    for (let index = 0; index < 70; index += 1) {
      await subject.accept('png', PNG);
      clock.advance(1);
    }

    expect(store.count).toBe(64);
    expect(store.removed).toEqual(store.written.slice(0, 6));
    // The newest is still there, which is the one whose path was just handed to a session.
    expect(store.bytesOf(String(store.written.at(-1)))).toEqual(PNG);
  });

  it('still answers with the path when the directory cannot be tidied', async () => {
    const { inbox: subject, store, logger } = inbox();
    store.failNames = true;

    const written = await subject.accept('png', PNG);
    expect(written.ok).toBe(true);
    expect(logger.logged('paste_trim_failed')).toBe(true);
  });
});

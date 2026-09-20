// `POST /pasted-images` — P5a-T8, SEC-FS-5.
//
// The headers are not tested here: CoreServer screens every request before a route sees it, and
// core-server.test.ts and loopback-guard.test.ts own those refusals. What is this route's own is
// the ENVELOPE — base64 that is really base64, JSON that is really JSON — and the status it picks
// for each way the image itself can be refused.
import { describe, expect, it } from 'vitest';
import { PasteInbox } from '../../../core/application/paste-inbox.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { PasteRoute } from '../../../core/http/paste-route.ts';
import { MAX_PASTED_IMAGE_BYTES } from '../../../contracts/pasted-image.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakePastedImageStore } from '../../fakes/fake-pasted-image-store.ts';

const FACTS: RequestFacts = { method: 'POST', url: '/pasted-images', headers: {} };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a, 0x2a]);

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function route(): { pasteRoute: PasteRoute; store: FakePastedImageStore } {
  const store = new FakePastedImageStore();
  const inbox = new PasteInbox({ store, clock: new FakeClock(), logger: new FakeLogger() });
  return { pasteRoute: new PasteRoute(inbox), store };
}

async function post(
  pasteRoute: PasteRoute,
  body: string,
): Promise<{ status: number; body: unknown }> {
  return pasteRoute.handle(FACTS, body);
}

describe('PasteRoute', () => {
  it('writes the image and answers 201 with the path', async () => {
    const { pasteRoute, store } = route();
    const answer = await post(pasteRoute, JSON.stringify({ kind: 'png', data: base64(PNG) }));

    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ path: expect.stringContaining('paste-') as unknown });
    expect(store.count).toBe(1);
    expect(store.bytesOf(String(store.written[0]))).toEqual(PNG);
  });

  it('spends the paste budget, which is neither of the other two', () => {
    const { pasteRoute } = route();
    expect(pasteRoute.limit).toBe('paste');
    expect(pasteRoute.credential).toBe('token');
    expect(pasteRoute.method).toBe('POST');
  });

  it('refuses a body that is not JSON, and one that is not an object', async () => {
    const { pasteRoute, store } = route();
    for (const body of ['', 'not json', 'null', '"a string"', '[1,2]']) {
      expect((await post(pasteRoute, body)).status).toBe(400);
    }
    expect(store.count).toBe(0);
  });

  it('refuses base64 that is not base64, rather than decoding the parts that are', async () => {
    const { pasteRoute, store } = route();
    const good = base64(PNG);
    // `Buffer.from(…, 'base64')` DROPS characters outside the alphabet, so each of these would
    // otherwise decode to something shorter and entirely plausible.
    for (const data of [`${good}!!`, good.slice(0, -1), 'iVBO RwoA', '====', 'a']) {
      expect((await post(pasteRoute, JSON.stringify({ kind: 'png', data }))).status).toBe(400);
    }
    expect(store.count).toBe(0);
  });

  it('refuses a missing or non-string data field', async () => {
    const { pasteRoute } = route();
    expect((await post(pasteRoute, JSON.stringify({ kind: 'png' }))).status).toBe(400);
    expect((await post(pasteRoute, JSON.stringify({ kind: 'png', data: 7 }))).status).toBe(400);
    expect((await post(pasteRoute, JSON.stringify({ kind: 'png', data: '' }))).status).toBe(400);
  });

  it('names the domain refusal back, because the client supplied both halves of it', async () => {
    const { pasteRoute } = route();
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00]);

    expect(await post(pasteRoute, JSON.stringify({ kind: 'png', data: base64(gif) }))).toEqual({
      status: 400,
      body: { error: 'not_that_kind' },
    });
    expect(await post(pasteRoute, JSON.stringify({ kind: 'bmp', data: base64(PNG) }))).toEqual({
      status: 400,
      body: { error: 'unknown_kind' },
    });
  });

  it('answers 413 for an image over the cap, not 400', async () => {
    const { pasteRoute, store } = route();
    const huge = new Uint8Array(MAX_PASTED_IMAGE_BYTES + 4);
    huge.set(PNG.subarray(0, 8), 0);

    const answer = await post(pasteRoute, JSON.stringify({ kind: 'png', data: base64(huge) }));
    expect(answer).toEqual({ status: 413, body: { error: 'too_large' } });
    expect(store.count).toBe(0);
  });
});

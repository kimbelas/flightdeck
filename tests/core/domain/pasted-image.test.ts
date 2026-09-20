// P5a-T8. Four refusals, and the one worth the class is `not_that_kind`.
import { describe, expect, it } from 'vitest';
import { PastedImage } from '../../../core/domain/pasted-image.ts';
import { MAX_PASTED_IMAGE_BYTES } from '../../../contracts/pasted-image.ts';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(extra = 8): Uint8Array {
  return new Uint8Array([...PNG, ...new Array<number>(extra).fill(0x21)]);
}

describe('PastedImage.from', () => {
  it('accepts a PNG claimed as a PNG and keeps the bytes and the extension', () => {
    const image = PastedImage.from('png', png());
    expect(image.ok).toBe(true);
    if (!image.ok) return;
    expect(image.value.kind).toBe('png');
    expect(image.value.extension).toBe('.png');
    expect([...image.value.bytes.subarray(0, 8)]).toEqual(PNG);
  });

  it('refuses a kind it does not know, whatever the bytes are', () => {
    expect(PastedImage.from('bmp', png())).toEqual({ ok: false, error: 'unknown_kind' });
    expect(PastedImage.from(undefined, png())).toEqual({ ok: false, error: 'unknown_kind' });
    expect(PastedImage.from('../png', png())).toEqual({ ok: false, error: 'unknown_kind' });
  });

  it('refuses an empty body', () => {
    expect(PastedImage.from('png', new Uint8Array())).toEqual({ ok: false, error: 'empty' });
  });

  it('refuses one byte over the cap, and accepts one byte under it', () => {
    const over = new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1);
    over.set(PNG, 0);
    expect(PastedImage.from('png', over)).toEqual({ ok: false, error: 'too_large' });

    const under = new Uint8Array(MAX_PASTED_IMAGE_BYTES);
    under.set(PNG, 0);
    expect(PastedImage.from('png', under).ok).toBe(true);
  });

  it('refuses bytes that are not the kind they claim to be', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00]);
    expect(PastedImage.from('png', gif)).toEqual({ ok: false, error: 'not_that_kind' });
    // Nothing at all, claimed as an image: this is what a text body posted at the route looks like.
    const text = new TextEncoder().encode('hello there');
    expect(PastedImage.from('png', text)).toEqual({ ok: false, error: 'not_that_kind' });
  });

  it('checks the size before the signature, so an enormous non-image is refused as too large', () => {
    expect(PastedImage.from('png', new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1))).toEqual({
      ok: false,
      error: 'too_large',
    });
  });
});

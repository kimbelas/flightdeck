// P5a-T8. The signature table is the interesting half: everything else here is a lookup.
import { describe, expect, it } from 'vitest';
import {
  MAX_PASTED_IMAGE_BYTES,
  PASTED_IMAGE_KINDS,
  extensionFor,
  isPastedImageKind,
  pastedImageKindOf,
  signatureMatches,
  type PastedImageKind,
} from '../../contracts/pasted-image.ts';

const HEADS: Readonly<Record<PastedImageKind, readonly number[]>> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
};

function head(kind: PastedImageKind, extra = 0): Uint8Array {
  return new Uint8Array([...HEADS[kind], ...new Array<number>(extra).fill(0)]);
}

describe('pasted image kinds', () => {
  it('maps every media type the clipboard reports', () => {
    expect(pastedImageKindOf('image/png')).toBe('png');
    expect(pastedImageKindOf('IMAGE/PNG')).toBe('png');
    // Chromium reports `image/png` bare, but a file dropped from disk can carry a charset.
    expect(pastedImageKindOf('image/jpeg; charset=binary')).toBe('jpeg');
    expect(pastedImageKindOf('image/jpg')).toBe('jpeg');
  });

  it('refuses a media type that is not an image it accepts', () => {
    expect(pastedImageKindOf('image/bmp')).toBeUndefined();
    expect(pastedImageKindOf('text/plain')).toBeUndefined();
    expect(pastedImageKindOf('image/svg+xml')).toBeUndefined();
    expect(pastedImageKindOf('')).toBeUndefined();
  });

  it('guards the kind itself', () => {
    expect(isPastedImageKind('png')).toBe(true);
    expect(isPastedImageKind('PNG')).toBe(false);
    expect(isPastedImageKind(undefined)).toBe(false);
    expect(isPastedImageKind({ toString: () => 'png' })).toBe(false);
  });

  it('gives every kind an extension', () => {
    for (const kind of PASTED_IMAGE_KINDS) expect(extensionFor(kind)).toMatch(/^\.[a-z]+$/u);
    expect(extensionFor('jpeg')).toBe('.jpg');
  });

  it('caps a decoded image at six megabytes', () => {
    expect(MAX_PASTED_IMAGE_BYTES).toBe(6 * 1024 * 1024);
  });
});

describe('signatureMatches', () => {
  it('accepts every kind against its own first bytes', () => {
    for (const kind of PASTED_IMAGE_KINDS) {
      expect(signatureMatches(kind, head(kind, 32))).toBe(true);
    }
  });

  it('refuses one kind claimed over the bytes of another', () => {
    expect(signatureMatches('png', head('gif'))).toBe(false);
    expect(signatureMatches('jpeg', head('png'))).toBe(false);
    // The one that matters: a PNG is not a WebP, and both start with four bytes of something.
    expect(signatureMatches('webp', head('png', 32))).toBe(false);
  });

  it('ignores the four length bytes in the middle of a WebP header', () => {
    const small = head('webp');
    const large = new Uint8Array(small);
    large.set([0xff, 0xff, 0xff, 0x0f], 4);
    expect(signatureMatches('webp', small)).toBe(true);
    expect(signatureMatches('webp', large)).toBe(true);
  });

  it('refuses a buffer shorter than the signature rather than reading past it', () => {
    expect(signatureMatches('png', new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(signatureMatches('webp', new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
    expect(signatureMatches('png', new Uint8Array())).toBe(false);
  });
});

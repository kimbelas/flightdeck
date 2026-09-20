// What a pasted image is on the wire, and how to tell that it is one — P5a-T8.
//
// Shared by core and the browser, so nothing here imports `node:*`: the deck bundles this file.
// `pastedImageDirectory()` lives in pasted-image-file.ts for exactly that reason, the way
// store-file.ts is kept apart from the things that describe the store.
//
// **The kind is checked against the bytes, not taken from the claim.** `clipboardData` reports a
// media type the page hands us and the route takes a string, so "png" is an assertion by the
// client until the first eight bytes agree with it. The file is written to disk and its path is
// then typed into a live session, which is the one place in Flightdeck where a browser can put a
// byte somewhere a later process will open — SEC-FS-5 is the row that says how narrow that is.

export const PASTED_IMAGE_KINDS = ['png', 'jpeg', 'gif', 'webp'] as const;

export type PastedImageKind = (typeof PASTED_IMAGE_KINDS)[number];

/**
 * The decoded cap, in bytes.
 *
 * A 4K screenshot is 2-4 MB as PNG. Six leaves room for one without inviting a video: base64 adds
 * a third on the wire, which is what sets the `paste` body budget in core/http/limits.ts.
 */
export const MAX_PASTED_IMAGE_BYTES = 6 * 1024 * 1024;

/** The path the deck posts to, through the same-origin rewrite that attaches the bearer. */
export const PASTED_IMAGE_PATH = '/pasted-images';

const EXTENSIONS: Readonly<Record<PastedImageKind, string>> = {
  png: '.png',
  jpeg: '.jpg',
  gif: '.gif',
  webp: '.webp',
};

const MEDIA_TYPES: Readonly<Record<string, PastedImageKind>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * The bytes a file of each kind starts with.
 *
 * `undefined` is a byte this signature does not constrain — WebP is `RIFF....WEBP`, where the four
 * in the middle are the file length and may be anything.
 */
const SIGNATURES: Readonly<Record<PastedImageKind, readonly (number | undefined)[]>> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38],
  webp: [
    0x52,
    0x49,
    0x46,
    0x46,
    undefined,
    undefined,
    undefined,
    undefined,
    0x57,
    0x45,
    0x42,
    0x50,
  ],
};

export function isPastedImageKind(value: unknown): value is PastedImageKind {
  return typeof value === 'string' && PASTED_IMAGE_KINDS.some((kind) => kind === value);
}

/** The kind a clipboard media type means, or `undefined` for one this does not accept. */
export function pastedImageKindOf(mediaType: string): PastedImageKind | undefined {
  return MEDIA_TYPES[mediaType.toLowerCase().split(';')[0]?.trim() ?? ''];
}

export function extensionFor(kind: PastedImageKind): string {
  return EXTENSIONS[kind];
}

/** Whether `bytes` actually begins like a file of that kind. */
export function signatureMatches(kind: PastedImageKind, bytes: Uint8Array): boolean {
  const signature = SIGNATURES[kind];
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => byte === undefined || bytes[index] === byte);
}

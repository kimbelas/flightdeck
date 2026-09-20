// The browser half of the image paste — P5a-T8.
//
// Goes through `/api/core/*`, the same-origin rewrite `pane-ticket.ts` already uses: `proxy.ts`
// attaches the per-boot bearer server-side, so the page can hand core an image without ever
// holding the token (D32).
//
// Base64 rather than a `FormData` upload, and that is SEC-HTTP-4 rather than taste. A JSON body is
// what forces a CORS preflight core never answers; `multipart/form-data` is a *simple request*,
// which is the one shape another origin can post without being asked. The third it adds to the
// wire is the control working.
import { PASTED_IMAGE_PATH, type PastedImageKind } from '../../contracts/pasted-image.ts';

const PASTE_ROUTE = `/api/core${PASTED_IMAGE_PATH}`;

/** What came back, or why nothing did. `refusal` is core's own word, shown to the person as-is. */
export type PasteUpload =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly refusal: string };

/**
 * Hands `bytes` to core and answers with the path it wrote.
 *
 * Never throws and never retries. Core being down is a thing a pane renders, and a retry on a
 * refusal is a retry against the control that refused it (`pane-ticket.ts` says the same).
 */
export async function uploadPastedImage(
  kind: PastedImageKind,
  bytes: ArrayBuffer,
): Promise<PasteUpload> {
  try {
    const response = await fetch(PASTE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, data: base64Of(bytes) }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (response.ok && typeof fields['path'] === 'string') {
      return { ok: true, path: fields['path'] };
    }
    const error = fields['error'];
    return { ok: false, refusal: typeof error === 'string' ? error : 'core refused the image' };
  } catch {
    return { ok: false, refusal: 'could not reach core' };
  }
}

/**
 * `btoa` on a binary string, built in chunks.
 *
 * `String.fromCharCode(...bytes)` on a six-megabyte array is a six-million-argument call and
 * throws `RangeError: Maximum call stack size exceeded` — which would make the failure depend on
 * how big the screenshot was. 8 KiB at a time has no such cliff.
 */
function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)));
  }
  return btoa(chunks.join(''));
}

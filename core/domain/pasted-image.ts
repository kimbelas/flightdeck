// One image on its way from the clipboard to disk — P5a-T8.
//
// A value object with a validating factory (CODING-STANDARDS R6), and it is where every check on
// a pasted image lives, because the route's job is to decode a body and this one's is to decide
// whether what came out is an image at all.
//
// Three refusals, and the third is the one that matters. A body can claim any kind it likes; the
// bytes are checked against that claim before anything is written, so a `.png` under
// `%LOCALAPPDATA%\flightdeck\pasted` is a PNG. The path of that file is typed into a live Claude
// session immediately afterwards (SEC-FS-5), which makes "what actually got written" a question
// with an audience.
import {
  MAX_PASTED_IMAGE_BYTES,
  isPastedImageKind,
  extensionFor,
  signatureMatches,
  type PastedImageKind,
} from '../../contracts/pasted-image.ts';
import { err, ok, type Result } from '../shared/result.ts';

export type PasteRefusal = 'unknown_kind' | 'empty' | 'too_large' | 'not_that_kind';

export class PastedImage {
  private readonly imageKind: PastedImageKind;
  private readonly content: Uint8Array;

  private constructor(kind: PastedImageKind, content: Uint8Array) {
    this.imageKind = kind;
    this.content = content;
  }

  public get kind(): PastedImageKind {
    return this.imageKind;
  }

  public get bytes(): Uint8Array {
    return this.content;
  }

  public get extension(): string {
    return extensionFor(this.imageKind);
  }

  /**
   * Accepts `bytes` as an image of `kind`, or says why not.
   *
   * The order is deliberate: the size cap runs before the signature, so an enormous body is
   * refused without scanning it, and the signature runs before anything reaches a file system.
   */
  public static from(kind: unknown, bytes: Uint8Array): Result<PastedImage, PasteRefusal> {
    if (!isPastedImageKind(kind)) return err('unknown_kind');
    if (bytes.length === 0) return err('empty');
    if (bytes.length > MAX_PASTED_IMAGE_BYTES) return err('too_large');
    if (!signatureMatches(kind, bytes)) return err('not_that_kind');
    return ok(new PastedImage(kind, bytes));
  }
}

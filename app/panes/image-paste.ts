// Ctrl+V of an image, in a pane — P5a-T8, SPEC §3.2 item 2.
//
// xterm has no idea what an image is: its own paste handler reads `text/plain` off the clipboard
// and a screenshot has none, so pasting one into a pane today does nothing at all — silently,
// which is the worst kind of nothing. This listens on the way DOWN (capture phase) on the pane
// host, so it sees the event before xterm's textarea does, and it only takes over when the
// clipboard actually holds an image it accepts. A text paste is never touched.
//
// **It types the path, it does not send the image.** The file goes to core over HTTP and the PATH
// comes back; the path is then written into the pane as ordinary input, over the socket bound to
// that pane (SEC-WS-3). So the thing that puts bytes in front of a session is still the session's
// own socket, and Claude Code reads the image the way it reads any file it is given.
import { pastedImageKindOf, type PastedImageKind } from '../../contracts/pasted-image.ts';
import { uploadPastedImage, type PasteUpload } from './paste-upload.ts';

export interface ImagePasteListeners {
  /** Types text into the pane, exactly as a keystroke would arrive. */
  onPath(path: string): void;
  /** Something to show the person: a refusal, or that an upload is in flight. */
  onNote(note: string | undefined): void;
}

type Upload = (kind: PastedImageKind, bytes: ArrayBuffer) => Promise<PasteUpload>;

export class ImagePaste {
  private readonly listeners: ImagePasteListeners;
  private readonly upload: Upload;

  constructor(listeners: ImagePasteListeners, upload: Upload = uploadPastedImage) {
    this.listeners = listeners;
    this.upload = upload;
  }

  /** Listens on `host` until the returned teardown is called. */
  public attach(host: HTMLElement): () => void {
    const onPaste = (event: ClipboardEvent): void => {
      const file = firstImage(event.clipboardData);
      if (file === undefined) return;
      // Only once we have decided to handle it: a text paste must reach xterm untouched.
      //
      // **`stopPropagation` is the one that matters here, and that is measured.** xterm's handler
      // reads `clipboardData` itself rather than waiting for the browser to insert anything, so
      // `preventDefault` alone does NOT stop it — with the guard above removed and only
      // `preventDefault` called, every text paste still reached the terminal and the smoke check
      // for it passed against a build that was intercepting all of them. Stopping the event in
      // the capture phase is what keeps it from the textarea. `preventDefault` stays for the
      // browser's own default, which for a file is inserting its name.
      event.preventDefault();
      event.stopPropagation();
      void this.send(file.kind, file.blob);
    };
    // Capture, because xterm's own handler is on the textarea inside this element.
    host.addEventListener('paste', onPaste, true);
    return () => {
      host.removeEventListener('paste', onPaste, true);
    };
  }

  private async send(kind: PastedImageKind, blob: File): Promise<void> {
    this.listeners.onNote(`pasting ${kind} — ${sizeOf(blob.size)}`);
    const written = await this.upload(kind, await blob.arrayBuffer());
    if (!written.ok) {
      this.listeners.onNote(`image not pasted — ${written.refusal}`);
      return;
    }
    this.listeners.onNote(undefined);
    // A trailing space, and quotes only when the path has one in it. `%LOCALAPPDATA%` contains the
    // account name, and an account name may contain a space — so this is not a hypothetical, it is
    // whoever has a space in their Windows profile getting a broken paste and nobody else.
    this.listeners.onPath(`${quoteIfNeeded(written.path)} `);
  }
}

interface PastedFile {
  readonly kind: PastedImageKind;
  readonly blob: File;
}

/**
 * The first image on the clipboard, if any.
 *
 * `files` rather than `items`: a screenshot arrives as a file, and `items` also carries the
 * `text/html` and `text/plain` flavours a copied web image brings with it — taking the first of
 * those would turn "paste this picture" into "paste some markup".
 */
function firstImage(data: DataTransfer | null): PastedFile | undefined {
  for (const blob of data?.files ?? []) {
    const kind = pastedImageKindOf(blob.type);
    if (kind !== undefined) return { kind, blob };
  }
  return undefined;
}

function quoteIfNeeded(path: string): string {
  return /\s/u.test(path) ? `"${path}"` : path;
}

function sizeOf(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${String(Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

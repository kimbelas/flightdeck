// Reading a transcript from a byte offset, as a dependency — P1-T7, SEC-FS-1.
//
// The port hands back **facts plus bytes**, never a decision. Whether a restart means "drop the
// digest and start again" or "publish a `restarted` event" is the application's to make; all the
// adapter is allowed to decide is the mechanical part it needs in order to choose where to read
// from, which is whether this is still the same file.
//
// `read` is the only operation, and it takes the cursor rather than an offset, because the offset
// alone cannot answer the question the tail actually has. A transcript is deleted after
// `cleanupPeriodDays` (30) and a session id can be resumed into a fresh file at the same path, so
// "the file is 40 KB and I have read 60 KB" and "the file is 80 KB and it is a different file" are
// both real, and only the second one is invisible to a size comparison.

/** Where a tail left off. Opaque to everything but the adapter that produced the identity. */
export interface TranscriptCursor {
  /** Bytes of this file already handed to the tail. */
  readonly offset: number;
  /**
   * Which file that offset belongs to, or `''` before the first read.
   *
   * `dev:ino:birthtime`. **NTFS** gives a real file index and a real creation time through
   * `fs.stat` (measured, P1-T7), so on the platform Flightdeck targets this changes when the file
   * is replaced even if the replacement is the same length at the same path — the case a size
   * comparison cannot see, and the one `--bg --resume` produces.
   *
   * It is not a universal guarantee, and CI is what established that: ext4 hands a deleted inode
   * straight to the next file and reports no true creation time, so on Linux a same-length
   * replacement is indistinguishable from nothing having been appended. Shrinking is still caught
   * everywhere, because that is arithmetic. `tests/win/transcript-identity.test.ts` asserts the
   * NTFS half on Windows rather than asserting a weaker thing everywhere.
   */
  readonly identity: string;
}

export const NEW_TRANSCRIPT: TranscriptCursor = { offset: 0, identity: '' };

export interface TranscriptSlice {
  /** The text read, starting at `from`. Empty when nothing was appended. */
  readonly text: string;
  /** Where this slice starts. The cursor's offset, unless the file restarted — then 0. */
  readonly from: number;
  /** Where the next read starts. `from + byteLength(text)`. */
  readonly to: number;
  /** The file's identity now, to be carried in the next cursor. */
  readonly identity: string;
  /**
   * The file shrank or was replaced, so everything before `from` is gone.
   *
   * Not an error. A resumed session writes a new transcript at a path Flightdeck was already
   * tailing, and the honest response is to forget what was read rather than to splice a new file
   * onto the tail of an old one and parse the seam.
   */
  readonly restarted: boolean;
  /**
   * Nothing could be read — no file yet, no permission, a delete mid-read.
   *
   * Feed 4 is best-effort (SPEC §4.2), so this is an ordinary state and the cursor is unchanged.
   * It is never an exception: a transcript that cannot be read must cost one card its extras.
   */
  readonly unreadable: boolean;
}

export interface TranscriptFile {
  /** @throws never — everything that can go wrong comes back as `unreadable`. */
  read(path: string, cursor: TranscriptCursor): Promise<TranscriptSlice>;
}

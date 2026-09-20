// Where a validated image is put, as a dependency — P5a-T8.
//
// An interface rather than `node:fs` in the use case, for the usual reason (CODING-STANDARDS R2):
// `PasteInbox` decides what a file is called and how many are kept, and neither decision should
// need a disk to be asserted on.
export interface PastedImageStore {
  /** Writes `bytes` under `name` and answers with the absolute path it used. */
  put(name: string, bytes: Uint8Array): Promise<string>;

  /** File names currently held, newest last. Used to enforce the retention cap. */
  names(): Promise<readonly string[]>;

  /** Removes one file. A name that is already gone is not an error. */
  remove(name: string): Promise<void>;
}

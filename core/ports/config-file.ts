// Reading and rewriting a file that belongs to somebody else (SEC-FS-3, P1-T11).
//
// A port for the usual reason — `ConnectPlanner` and the CLI are testable without a temp tree —
// and for one specific to this task: the whole safety of Connect is in the ORDER of back up, write
// temp, rename. That order belongs to one class with one test, not to whichever caller remembered.
export interface ConfigFile {
  /** The contents, or `undefined` if the file is not there. Never throws on absence. */
  read(path: string): string | undefined;

  /**
   * Backs the file up, then replaces it atomically.
   *
   * @returns the backup's path, so the caller can tell the owner where it is.
   * @throws if the backup could not be written — nothing is replaced in that case, because a
   * rewrite whose backup failed is the one case where an interrupted Connect is unrecoverable.
   */
  replace(path: string, contents: string): string;

  /**
   * Writes a file that is not there yet. No backup, because there is nothing to back up.
   *
   * Separate from `replace` rather than a branch inside it (P5a-T7). `replace` throws when the
   * backup fails, and that guarantee is what makes an interrupted rewrite recoverable — a version
   * that silently skipped the backup for a missing file would have to decide "missing" for itself,
   * and would then be one race away from replacing a real file without one.
   *
   * @throws if the write fails. Nothing exists to be left half-written.
   */
  create(path: string, contents: string): void;
}

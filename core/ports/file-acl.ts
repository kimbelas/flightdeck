// Who may read a file Flightdeck wrote — SEC-FS-4 (P1-T12).
//
// A port because there are now three callers and two of them are not core: `WindowsTokenFile`
// applies it to the token and the ingest key, the composition root applies it to the store's
// directory, and `scripts/doctor` reads it back to say whether it is right. One of those is a
// check rather than a write, and a check that constructs its own icacls call is a second opinion
// about what "restricted" means.
//
// The Windows shape leaks through the names deliberately: an ACL is not a POSIX mode, a directory
// grant is inheritable and a file grant is not, and pretending otherwise would make the one
// distinction that matters here invisible (see `restrictDirectory`).
export interface AclGrant {
  /** The principal as Windows resolved it — `KIMPOY\Kimpoy`, `BUILTIN\Administrators`. */
  readonly account: string;
  /** The rights, verbatim and lowercased: `(f)`, `(oi)(ci)(f)`, `(rx)`. */
  readonly rights: string;
}

export interface AclFacts {
  readonly path: string;
  readonly exists: boolean;
  readonly grants: readonly AclGrant[];
}

export interface FileAcl {
  /**
   * Leaves exactly one grant on a file: the current user, full control.
   *
   * @throws if the current user cannot be resolved or the platform tool refuses. A failure here is
   * fatal on purpose — a warning about a secret that is world-readable would be ignored.
   */
  restrictFile(path: string): void;

  /**
   * The same, on a directory, and **inheritable** so everything created inside it gets it too.
   *
   * That is the whole reason this method exists next to `restrictFile`. SQLite writes
   * `flightdeck.db-wal` and `flightdeck.db-shm` beside the database *after* anything could have
   * restricted the database itself, and the WAL holds the most recent committed rows — hook
   * payloads included. Restricting the file and not the directory protects the older half of the
   * data and leaves the newest half inheriting whatever `%LOCALAPPDATA%` hands down.
   */
  restrictDirectory(path: string): void;

  /** The ACL as the OS actually stored it. `exists: false` for a path that is not there. */
  describe(path: string): AclFacts;
}

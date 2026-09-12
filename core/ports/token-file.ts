// Where the per-boot token is published so the rest of the machine can find it (SEC-HTTP-3).
//
// A port rather than a direct fs call because the ACL half is Windows-specific and the issuing
// half is not: TokenIssuer is tested with FakeTokenFile on any platform, and the real ACL is
// exercised by tests/win/** on windows-latest (CODING-STANDARDS.md §10.2).
export interface TokenFile {
  /** Writes the token, replacing any previous one, with an ACL for the current user only. */
  write(token: string): void;

  /**
   * The secret on disk, or `undefined` if there is none.
   *
   * Added for the ingest key (SEC-HTTP-7), which is read-or-create rather than issued fresh: it
   * must survive a core restart or it would be no better than the per-boot token it exists to
   * complement (contracts/ingest-key.ts). The per-boot token never calls it.
   */
  read(): string | undefined;

  /** Removes it. Called on shutdown so a stale token never outlives the core that issued it. */
  remove(): void;

  /** Absolute path, for the operator-facing `flightdeck-core status`. */
  location(): string;
}

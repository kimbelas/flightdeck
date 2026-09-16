// Turning a path somebody typed into the path the filesystem means — P3-T1, SEC-FS-1.
//
// This is the port the `ReadPolicy` header has been pointing at since P1-T12: *"a real path is
// canonicalised by the adapter that owns it, and a policy that resolved paths itself would be a
// second opinion about `realpath`."* Until now nothing needed one, because every path core opened
// was composed from a config directory and an id. A project root is the first path that arrives
// from outside.
//
// **`realpath` is a security control here, not a tidy-up.** It is what makes SEC-FS-1's fourth
// check possible at all: `<project>\link` may be a junction to `C:\Users\belas\.claude-365`, and
// no amount of string work on the first path can see the second. Resolving first and comparing
// afterwards is the only order that catches it — measured on NTFS in `tests/win/`, where junctions
// are not symlinks and are the shape this repository actually has to survive.
//
// **Existence and kind come back together, from the resolved path.** They are one answer because
// they are one decision — "is this a folder core may be pointed at" — and splitting them would
// invite a caller to resolve a path and then stat something else.

export interface CanonicalPath {
  /** What `realpath` returned: absolute, junctions and links resolved, in the filesystem's casing. */
  readonly path: string;
  /** Whether it is a directory. A file is a refusal upstream, never a path to take the parent of. */
  readonly isDirectory: boolean;
}

export interface PathCanonicaliser {
  /**
   * The real path behind `path`, or `undefined` if there is nothing there.
   *
   * @throws never. A missing folder, a denied ACL and a drive that is not mounted are all ordinary
   * answers to "the owner typed a path", and none of them is a reason to fail a request with a
   * stack trace.
   */
  canonicalise(path: string): Promise<CanonicalPath | undefined>;
}

// Looking at what is inside an imported project, as a dependency — P3-T2, SEC-FS-1.
//
// A third file port beside `JobFiles` and `TranscriptFile`, and the difference is again the access
// pattern rather than the filesystem. A transcript is tailed from a byte offset; a job file is one
// small file read whole. This is the shape stack and git detection needs: what is in this folder,
// when did this file last change, and — once — the one line inside a `.git` that is a pointer
// rather than a directory.
//
// **Nothing here screens anything.** Every path handed to this adapter has already been through
// `ProjectRegistry.resolve`, which canonicalises with `realpath` and then screens the result —
// that order is SEC-FS-1's junction check, and it is the only one that catches a `mklink /J` out
// of a project root. An adapter that screened as well would be a second opinion about what may be
// opened, and there is exactly one place that decides (P1-T12).
//
// **Every failure is an ordinary answer.** An unplugged external drive, a folder deleted between
// two requests, a `.git` that is a directory this build cannot open — all of them are things a
// panel says nothing about rather than things that fail a request.

export interface FileFacts {
  readonly isDirectory: boolean;
  /**
   * Last-modified time in whole seconds since the epoch.
   *
   * Seconds rather than milliseconds because this is a cache signature and nothing else:
   * `statusline.py` truncates the same way (`int(os.path.getmtime(path))`), and a float that
   * differs in its last bits between two stats of an unchanged file would invalidate a cache for
   * no reason. Sub-second precision would buy nothing a 4-second TTL does not already give.
   */
  readonly modifiedAt: number;
}

export interface ProjectFiles {
  /**
   * The names of the entries directly inside `directory` — not paths, and not recursive.
   *
   * @param directory an absolute path, already resolved and screened.
   * @param maxEntries stop after this many. A project root with 50 000 files in it is somebody
   * else's problem, and the caller is looking for five filenames.
   * @returns the names, or `[]` when the directory cannot be listed. @throws never.
   */
  list(directory: string, maxEntries: number): Promise<readonly string[]>;

  /**
   * What `path` is, or `undefined` when it is not there.
   *
   * One call rather than an `exists` and a `modifiedAt`, because every caller wants both and two
   * calls would be two chances for the answer to change underneath.
   *
   * @throws never.
   */
  facts(path: string): Promise<FileFacts | undefined>;

  /**
   * The first `maxBytes` of a small file, or `undefined` if it cannot be read.
   *
   * The HEAD rather than the tail, which is the opposite of `JobFiles`: the one file read through
   * here is a `.git` pointing at a linked worktree's real directory, and what matters is its first
   * line.
   *
   * @throws never.
   */
  read(path: string, maxBytes: number): Promise<string | undefined>;
}

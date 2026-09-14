// Reading a session's two job files, as a dependency — P2-T4, SEC-FS-1.
//
// A separate port from `TranscriptFile`, and the difference is the access pattern rather than the
// filesystem. A transcript is tailed: gigabytes, read forward from a byte offset, with a cursor
// that has to notice the file being replaced. These are two small files read whole, on demand, when
// somebody expands a row — `state.json` is about a kilobyte and `timeline.jsonl` grows a line per
// state transition. Giving them a cursor would be inventing a problem.
//
// **Absence is an ordinary answer, not an error.** `jobs/<shortId>/` exists only for background
// sessions — an interactive one has no job directory at all (F.7.1) — so "there is no file" is the
// correct answer for a whole class of rows and must not read as a failure. Every way this can go
// wrong comes back as `undefined`.

export interface JobFiles {
  /**
   * The text of one job file, or `undefined` if it cannot be read.
   *
   * @param path an absolute path, already screened by `ReadPolicy` — the adapter opens what it is
   * given and screens nothing, exactly as `FsTranscriptFile` does. The check belongs where the path
   * is accepted, and there is one such place (P1-T12).
   * @param maxBytes read no more than this. `timeline.jsonl` is unbounded in principle: it gains a
   * line per state transition and the daemon never truncates it, so the reader names a ceiling
   * rather than trusting the file. The TAIL is what is wanted, so an oversize file comes back as
   * its last `maxBytes`, not its first.
   * @throws never.
   */
  read(path: string, maxBytes: number): Promise<string | undefined>;
}

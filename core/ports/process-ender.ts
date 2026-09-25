// Ending a process core did not start — P6-T8, D63, and the one exception to SEC-PROC-5.
//
// A port for `ProcessProbe`'s reason: proving that a take-over ends the terminal's process and
// then adopts it would otherwise mean owning a real `claude.exe`, and then the test is about
// process lifetimes rather than about the order of two steps.
export interface ProcessEnder {
  /**
   * Ends `pid` and every process under it, if and only if it is `claude.exe`.
   *
   * The whole tree, because an idle interactive session still holds children — the shells its
   * tools ran and its stdio MCP servers (measured, RESEARCH.md G.60) — and closing a terminal ends
   * those too. Ending only the parent would orphan them.
   *
   * @returns whether the process is gone afterwards. `false` covers a pid that is not
   * `claude.exe`, which is left running: the image name is the guard against a pid Windows has
   * reissued since the listing named it.
   * @throws never.
   */
  end(pid: number): Promise<boolean>;
}

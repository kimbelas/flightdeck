// The smoke's scoreboard, and the two waits every check group needs.
//
// A hand-rolled runner rather than `@playwright/test`, and DECISIONS.md D35 carries the argument.
// The short version is that the thing under test is ONE page being driven through a sequence —
// `j` moves focus, `Enter` expands what `j` focused, `/` filters what `Enter` left open — so a
// runner whose unit is an isolated test with its own fixture would either re-navigate per
// assertion or hold the shared state it exists to prevent. A linear script is the honest shape,
// and it costs about forty lines.
//
// Every check is recorded rather than thrown, so one failure does not hide the thirty after it.
// That matters more here than in a unit suite: a smoke run costs a Next build, and finding out
// about one broken assertion per run is how a green suite takes four pushes to get green.

export class Report {
  constructor() {
    this.problems = [];
    this.passed = 0;
  }

  /** @param detail printed either way — a passing check's measurement is the evidence it is real. */
  check(name, passed, detail = '') {
    const suffix = detail === '' ? '' : ` — ${detail}`;
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
    if (passed) this.passed += 1;
    else this.problems.push(name);
  }

  group(title) {
    console.log(`\n${title}`);
  }

  /** @returns the process exit code: 0 with nothing on the list. */
  summary() {
    const total = this.passed + this.problems.length;
    if (this.problems.length === 0) {
      console.log(`\n${String(total)} checks, all passing.`);
      return 0;
    }
    console.log(`\n${String(this.problems.length)} of ${String(total)} FAILED:`);
    for (const problem of this.problems) console.log(`  - ${problem}`);
    return 1;
  }
}

/**
 * Polls `condition` until it is true, and returns whether it ever was.
 *
 * It returns rather than throws because a false is a failed CHECK, not a broken run — the caller
 * records it and carries on into the next group, which is the whole reason this file exists.
 */
export async function waitFor(condition, { timeout = 10_000, every = 50 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await condition()) return true;
    if (Date.now() >= until) return false;
    await pause(every);
  }
}

export function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether the page's own listener has seen a key yet.
 *
 * `page.keyboard.press` resolves when the event has been DISPATCHED, not when React has re-rendered
 * because of it, so every keyboard check needs something to wait on afterwards. Each one waits on
 * its own effect; this is only the floor under them.
 */
export function settle(page) {
  return page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );
}

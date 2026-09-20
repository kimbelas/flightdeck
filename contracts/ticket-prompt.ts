// The plan-first opening prompt a ticket session starts with — P4-T1, SPEC §5.6.
//
// **Lifted from `app-next/.claude/scripts/open-tab.mjs`, which is prior art and not inspiration**
// (SPEC §2.4). That script is how the owner starts a ticket today: it opens a Windows Terminal tab
// running `claude-isg-ticket -n <name> '<prompt>'`, and the prompt is the same four sentences
// every time. A preset that encoded the profile function and left the prompt to be retyped would
// have encoded the easy half.
//
// **Why the prompt asks for plan mode rather than a flag.** `claude-isg-ticket` pins
// `--model "opusplan[1m]"` and passes `--dangerously-skip-permissions`, and
// `--permission-mode plan` **cannot be combined with** `--dangerously-skip-permissions` — the CLI
// refuses the pair (verified 2026-09-10, recorded in open-tab.mjs beside the line that works
// around it). So plan mode is entered by asking for it in the first turn: with `opusplan` that
// turn onward runs on Fable 5.1, and `ExitPlanMode` returns to bypass, which is Opus 5 for the
// edit and the tests. The sentence below is load-bearing routing, not politeness.
//
// **The quote stripping is deliberately NOT lifted.** open-tab.mjs does
// `.replace(/['"]/g, '')` because its prompt is interpolated into a PowerShell `-Command` string,
// where an apostrophe ends the argument. Flightdeck never builds a command string: the prompt
// travels as an argv element today and as the `FD_PROMPT` environment variable once the launcher
// lands (SEC-PROC-1, P4-T2). Copying the strip would have carried a workaround for a bug this
// design does not have, and would have silently mangled a ticket title with an apostrophe in it.
//
// It lives in `contracts/` rather than `core/domain/` because both ends print it: core builds the
// argv and the deck shows the owner what is about to be sent, and a second copy of four sentences
// is how the two start disagreeing (CODING-STANDARDS §3, "Formatter classes in contracts/").

/**
 * A ticket-shaped session name — two to twelve letters, a hyphen, digits.
 *
 * open-tab.mjs tests `/XWEB-\d+/i`, which is one repository's issue prefix. The shape is
 * generalised here rather than the prefix copied: Flightdeck presets are per project and the next
 * project's tracker will not spell it `XWEB`. Everything that does not match is used exactly as
 * the owner typed it.
 */
const TICKET_SHAPE = /^[a-z]{2,12}-\d+$/i;

export class TicketPrompt {
  private readonly ticket: string;

  /**
   * @param sessionName what the session will be called — the ticket id, for a ticket session.
   * Trimmed, because it arrives from a text box, and upper-cased when it is ticket-shaped: the
   * paths in the prompt (`.claude/specs/<TICKET>/`) are the ones the tracker's own casing names.
   */
  constructor(sessionName: string) {
    const trimmed = sessionName.trim();
    this.ticket = TICKET_SHAPE.test(trimmed) ? trimmed.toUpperCase() : trimmed;
  }

  /** The ticket as it will appear in the prompt — upper-cased only when it is ticket-shaped. */
  public get name(): string {
    return this.ticket;
  }

  /**
   * The opening prompt, or `''` when there is no name to plan against.
   *
   * Empty rather than a prompt with a hole in it: `--bg` will not start without a prompt
   * (RESEARCH.md B.4), so an empty string is what makes the deck's start button stay disabled
   * until the owner has named the ticket — which is the honest state, since a plan-first prompt
   * that names nothing to plan is worse than no prompt at all.
   */
  public get text(): string {
    if (this.ticket === '') return '';
    return (
      `Enter plan mode first (EnterPlanMode), then plan ticket ${this.ticket}: ` +
      `read .claude/specs/${this.ticket}/ or .claude/state/${this.ticket}.md, ` +
      'map the change to file:line, name the spec that must fail on old code, ' +
      'list risks and whether a serve is needed. Do not edit until the plan is approved.'
    );
  }
}

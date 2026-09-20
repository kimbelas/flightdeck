// One preview's presentation, decided outside React — P5a-T4, CODING-STANDARDS §3.
//
// **The wording of the three reasons lives here and nowhere else.** `PreviewReason` is a closed
// vocabulary on the wire precisely so that the sentence a person reads is written in the deck: a
// free string in that field would be a way for model-written text to reach the page through the
// one field nobody screens (contracts/session-preview.ts).
//
// **`source` is not decoration.** `logs` is a SCREEN — what this session's terminal looks like —
// and `transcript` is a TRAIL of what it did, assembled because there was no screen to read. A
// heading that called the second one a screen would be the deck claiming to show something nobody
// rendered, so the two are labelled apart.
//
// Every line is model- or user-written (SEC-UI-2). Displayed, never interpreted, never made
// actionable — the same rule the files list obeys, and the caps are already applied by
// `parseSessionPreview` on the way in.
import type { PreviewReason, SessionPreview } from '../../contracts/session-preview.ts';

/** What the block calls itself. Two answers, because the two sources are not the same thing. */
export type PreviewHeading = 'last screen' | 'recent activity';

export class SessionPreviewViewModel {
  private readonly preview: SessionPreview;

  constructor(preview: SessionPreview) {
    this.preview = preview;
  }

  public get lines(): readonly string[] {
    return this.preview.lines;
  }

  public get isEmpty(): boolean {
    return this.preview.lines.length === 0;
  }

  /**
   * Whether this is a real terminal screen.
   *
   * The component draws the two differently: a screen is a fixed-width block that must not be
   * re-wrapped, because its alignment is the alignment Claude Code drew.
   */
  public get isScreen(): boolean {
    return this.preview.source === 'logs';
  }

  public get heading(): PreviewHeading {
    return this.isScreen ? 'last screen' : 'recent activity';
  }

  /**
   * Why this is not a screen, in a sentence, or `undefined` when it is one.
   *
   * Every sentence names the cause AND says whether it is worth trying again, because F.2.16
   * measured that the daemon's absence is permanent: it never comes back on its own, and only a
   * new `--bg` session starts one. Telling somebody to retry would be telling them to wait for
   * something that has already been proven not to happen.
   */
  public get note(): string | undefined {
    return noteFor(this.preview.reason);
  }

  /**
   * How old this preview is, in words.
   *
   * It is always shown, unlike the detail's timestamps, and that is the one thing the deck has to
   * be honest about here: a preview is a PHOTOGRAPH. It is never refreshed on a timer — one costs
   * a 2.7 s spawn and 330 KB (F.2.5, "never poll it") — so a screen that looks current and is four
   * minutes old is exactly what this line exists to prevent.
   */
  public takenAgo(now: number): string {
    const seconds = Math.max(0, Math.round((now - this.preview.at) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${String(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${String(minutes)}m ago`;
    return `${String(Math.round(minutes / 60))}h ago`;
  }
}

function noteFor(reason: PreviewReason | undefined): string | undefined {
  switch (reason) {
    case 'daemon_down':
      return 'The background service is not running, so there is no screen to read. It does not come back on its own — starting any background session brings it back.';
    case 'logs_failed':
      return 'The background service did not answer, so this is what the transcript says instead.';
    case 'no_claude':
      return 'claude.exe was not found, so there is nothing to ask.';
    case undefined:
      return undefined;
  }
}

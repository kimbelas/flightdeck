// Single presets and a typed ticket in the palette — P9-T4.
//
// What no unit test can see: the entries are actually in `Ctrl+K`, a ticket-shaped QUERY reaches
// whatever builds `Plan <id>` (the query is the palette hook's state, the presets are the store's),
// the entry is absent with no current project, Enter on it sends the ticket preset's own launch
// to core, and a built-in with no prompt opens its editor rather than sending a launch core would
// refuse. Every press here lands on the fixture core, which is the only place one may.
import { waitFor } from './report.mjs';
import { PROJECT } from './project-checks.mjs';
import { FIXTURE_TICKETS } from './ticket-checks.mjs';

const clean = (text) => (text ?? '').replaceAll(/\s+/gu, ' ').trim();

/**
 * @param section the project row's `section.presets`, four built-ins and nothing saved. Left that
 * way, with no current project and the palette closed: the one preset saved here is forgotten.
 */
export async function palettePresetChecks(page, report, core, section) {
  report.group('Presets and tickets in the palette (P9-T4)');
  if (!(await listChecks(page, report))) return;
  await noProjectChecks(page, report, core);
  await page.locator('[data-project-focus]').click();
  await waitFor(async () => (await page.locator('[data-project-focus][aria-pressed="true"]').count()) === 1); // prettier-ignore
  await planChecks(page, report, core);
  await editorChecks(page, report, core, section);
  await startableChecks(page, report, core, section);
  await page.locator('[data-project-focus]').click();
}

/** `Launch <project> · <preset>` for each of the four built-ins, in core's order. */
async function listChecks(page, report) {
  if (!(await openPalette(page, report, 'launch app-next'))) return false;
  const labels = await labelsOf(page);
  report.check(
    'the palette offers each preset as Launch <project> · <preset>, by name',
    labels.join(' | ') ===
      'Launch app-next · 365 | Launch app-next · isg | Launch app-next · orchestrator | Launch app-next · ticket',
    labels.join(' | '),
  );
  const hints = await hintsOf(page);
  report.check(
    'each says which account a press lands on — the routing hint is the description',
    hints[0]?.startsWith('365 · claude-365') === true &&
      hints[3]?.startsWith('isg · claude-isg-ticket') === true,
    hints.join(' | '),
  );
  await page.keyboard.press('Escape');
  return true;
}

/** With no current project a ticket id is not a guess about which repository it belongs to. */
async function noProjectChecks(page, report, core) {
  const before = core.launches.length;
  if (!(await openPalette(page, report, FIXTURE_TICKETS[0]))) return;
  const labels = await labelsOf(page);
  report.check(
    'with no current project a ticket-shaped query offers no Plan entry',
    !labels.some((label) => label.startsWith('Plan ')),
    labels.join(' | ') || '(nothing)',
  );
  await page.keyboard.press('Escape');
  report.check('and nothing was sent', core.launches.length === before);
}

/** In a current project the id plans the ticket through its `ticket` preset, listed or not. */
async function planChecks(page, report, core) {
  if (!(await openPalette(page, report, FIXTURE_TICKETS[0].toLowerCase()))) return;
  const labels = await labelsOf(page);
  report.check(
    'in a current project the query offers Plan <id> in <project>, first',
    labels[0] === `Plan ${FIXTURE_TICKETS[0]} in app-next`,
    labels.join(' | '),
  );
  report.check(
    'and its hint says the account and that the spec is on disk',
    /^isg · claude-isg-ticket( .*)? · on disk$/u.test((await hintsOf(page))[0] ?? ''),
    (await hintsOf(page))[0],
  );
  const before = core.launches.length;
  await page.keyboard.press('Enter');
  await waitFor(() => core.launches.length === before + 1);
  const body = core.launches.at(-1) ?? {};
  report.check(
    "Enter sends the ticket preset's launch — function, folder, name and plan-first prompt",
    core.launches.length === before + 1 &&
      body.profileFn === 'claude-isg-ticket' &&
      body.cwd === PROJECT &&
      body.name === FIXTURE_TICKETS[0] &&
      typeof body.prompt === 'string' &&
      body.prompt.startsWith('Enter plan mode first') &&
      body.prompt.includes(`.claude/specs/${FIXTURE_TICKETS[0]}/`),
    `${String(body.profileFn)} · ${String(body.name)} · ${String(body.cwd)}`,
  );

  if (!(await openPalette(page, report, 'XWEB-9999'))) return;
  report.check(
    'an id that is on disk nowhere is still offered, and says so',
    (await labelsOf(page))[0] === 'Plan XWEB-9999 in app-next' &&
      (await hintsOf(page))[0]?.endsWith('not on disk yet') === true,
    (await hintsOf(page))[0],
  );
  await page.keyboard.press('Escape');
}

/** A built-in stores no prompt, so its entry opens its editor with the caret where it is missing. */
async function editorChecks(page, report, core, section) {
  const before = core.launches.length;
  if (!(await openPalette(page, report, 'launch app-next ticket'))) return;
  await page.keyboard.press('Enter');
  const opened = await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);
  const focused = await waitFor(() =>
    page.evaluate(() => document.activeElement?.classList.contains('preset-session-name') === true),
  );
  report.check(
    'a built-in with no prompt opens its editor, caret in the ticket box',
    opened &&
      focused &&
      (await section.locator('.preset-chip[aria-pressed="true"]').textContent()) === 'ticket',
  );
  report.check(
    'and sends nothing — core would refuse an empty prompt',
    core.launches.length === before,
  );
  await page.keyboard.press('Escape');
  await section.locator('.preset-chip', { hasText: 'ticket' }).click();
}

/** A saved preset with a prompt launches in one press, exactly as its own start would. */
async function startableChecks(page, report, core, section) {
  await section.locator('.preset-chip', { hasText: '365' }).click();
  await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);
  await page.fill('.preset-prompt', 'summarise the open PRs');
  await page.fill('.preset-save-name', 'prs');
  await section.locator('.preset-save').click();
  const saved = await waitFor(async () => (await section.locator('.preset-chip', { hasText: 'prs' }).count()) === 1); // prettier-ignore
  report.check('a preset saved with a prompt appears in the panel', saved);
  if (!saved) return;

  if (!(await openPalette(page, report, 'launch app-next prs'))) return;
  const before = core.launches.length;
  await page.keyboard.press('Enter');
  await waitFor(() => core.launches.length === before + 1);
  const body = core.launches.at(-1) ?? {};
  report.check(
    'and its Launch entry starts it in one press, with its own prompt and folder',
    core.launches.length === before + 1 &&
      body.profileFn === 'claude-365' &&
      body.prompt === 'summarise the open PRs' &&
      body.cwd === PROJECT,
    `${String(body.profileFn)} · ${String(body.prompt)}`,
  );

  await section.locator('.preset-chip', { hasText: 'prs' }).click();
  await waitFor(async () => (await section.locator('.preset-forget').count()) === 1);
  await section.locator('.preset-forget').click();
  const gone = await waitFor(async () => (await section.locator('.preset-chip').count()) === 4);
  report.check('forgetting it leaves the four built-ins', gone && core.presets.size === 0);
}

/** Ctrl+K from wherever focus is, and a reported failure rather than a thrown one (group-checks). */
async function openPalette(page, report, query) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Control+k');
  const open = await waitFor(async () => (await page.locator('.palette-input').count()) > 0, {
    timeout: 10_000,
  });
  if (!open) report.check('Ctrl+K opens the palette', open);
  if (!open) return false;
  await page.locator('.palette-input').fill(query);
  return true;
}

async function labelsOf(page) {
  return (await page.locator('.palette-list .palette-label').allTextContents()).map(clean);
}

async function hintsOf(page) {
  return (await page.locator('.palette-list .palette-hint').allTextContents()).map(clean);
}

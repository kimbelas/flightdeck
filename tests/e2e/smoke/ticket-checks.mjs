// The ticket picker — P9-T3.
//
// The fixture map carries three ids, as core would after listing `.claude/specs/` and
// `.claude/state/` (`workflowMap` in fixture-core.mjs). What no unit test can see: the name box is
// actually wired to a `<datalist>` holding them in core's order, only on the `ticket` preset, and a
// typed id that is NOT on the list still starts a session — the list is an offer, not an allowlist.
import { waitFor } from './report.mjs';

/** What `workflowMap` in fixture-core.mjs sends, newest first. */
export const FIXTURE_TICKETS = ['XWEB-2126', 'XWEB-2113', 'XWEB-1830'];

/**
 * @param section the project row's `section.presets`, with its four built-ins and nothing saved.
 * Left in that state: nothing is saved here, and the editor is closed again before returning.
 */
export async function ticketChecks(page, report, core, section) {
  report.group('Presets — the ticket picker (P9-T3)');

  await section.locator('.preset-chip', { hasText: 'ticket' }).click();
  await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);
  const list = await section.locator('.preset-session-name').getAttribute('list');
  const offered = await section
    .locator('datalist.preset-tickets option')
    .evaluateAll((all) => all.map((option) => option.value));
  const wired =
    typeof list === 'string' &&
    list !== '' &&
    (await section.locator('datalist.preset-tickets').getAttribute('id')) === list;
  report.check('the ticket name box is wired to a datalist', wired, String(list));
  report.check(
    'which offers the project ids, newest first, exactly as core sent them',
    offered.join(' ') === FIXTURE_TICKETS.join(' '),
    offered.join(' '),
  );

  await pickChecks(page, report, core, section);
  await unlistedChecks(page, report, core, section);

  await section.locator('.preset-chip', { hasText: '365' }).click();
  await waitFor(async () => (await section.locator('.preset-agent').count()) === 1);
  report.check(
    'a literal preset keeps a plain name box — no datalist',
    (await section.locator('datalist.preset-tickets').count()) === 0 &&
      (await section.locator('.preset-session-name').getAttribute('list')) === null,
  );
  await section.locator('.preset-chip', { hasText: '365' }).click();
}

/** A listed id, chosen the way the browser fills it: the box's value becomes the id. */
async function pickChecks(page, report, core, section) {
  await page.fill('.preset-session-name', FIXTURE_TICKETS[0]);
  const before = core.launches.length;
  await section.locator('.preset-start').click();
  await waitFor(() => core.launches.length === before + 1);
  const body = core.launches.at(-1) ?? {};
  report.check(
    'a picked id plans that ticket, under claude-isg-ticket',
    body.name === FIXTURE_TICKETS[0] &&
      body.profileFn === 'claude-isg-ticket' &&
      typeof body.prompt === 'string' &&
      body.prompt.includes(`.claude/specs/${FIXTURE_TICKETS[0]}/`),
    `${String(body.name)} - ${String(body.profileFn)}`,
  );
}

/** An id with no spec yet — the spec may be about to be written, so it is still sent. */
async function unlistedChecks(page, report, core, section) {
  await page.fill('.preset-session-name', 'XWEB-9999');
  report.check(
    'a typed id that is not on disk still enables start',
    !(await section.locator('.preset-start').isDisabled()),
  );
  const before = core.launches.length;
  await section.locator('.preset-start').click();
  await waitFor(() => core.launches.length === before + 1);
  const body = core.launches.at(-1) ?? {};
  report.check(
    'and is sent as typed, with the plan-first prompt naming it',
    body.name === 'XWEB-9999' &&
      typeof body.prompt === 'string' &&
      body.prompt.includes('.claude/state/XWEB-9999.md'),
    String(body.name),
  );
}

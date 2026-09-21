// Preset groups, pressed from the palette — P6-T4, DECISIONS.md D17.
//
// **No session is started here and none could be.** A group press on a real core spends the
// owner's quota per preset, which is the one thing a smoke run must never do; the half that
// decides what a group IS and what a press costs is settled in `preset-group.test.ts` and
// `group-launcher.test.ts`. What lives on this side of the wire is the palette entry, what it
// sends, and what the deck does with the report — and the report is the interesting half, because
// a group press has no single outcome.
//
// **The partial failure is the case this group is really for.** The fixture fails the FIRST preset
// of every group on purpose, because two started and one did not is the normal shape of a bad
// morning — a preset naming a worktree that was deleted last night — and "which one" is the only
// useful thing a banner can say about it.
import { waitFor } from './report.mjs';
import { PROJECT } from './project-checks.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

export async function groupChecks(page, report, core) {
  report.group('Preset groups, one press (P6-T4)');

  // Two saved presets under one name, standing for something the owner did last week.
  core.seedGroup(PROJECT, 'morning');
  await page.reload();
  // **Clicked, not merely waited for.** `Ctrl+K` is a capturing WINDOW listener, and a page that
  // has just reloaded has focus nowhere the listener can be reached from — so the palette never
  // opened, `.palette-input` never appeared, and the fill threw thirty seconds later. It passed
  // locally against the production bundle and failed in CI against `next dev`, which is exactly
  // the split `npm run smoke:dev` exists to catch.
  const ready = await waitFor(async () => (await page.locator('main.deck').count()) === 1, {
    timeout: 20_000,
  });
  report.check('the deck came back after a reload', ready);
  if (!ready) return;
  await page.locator('main.deck').click({ position: { x: 5, y: 5 } });

  if (!(await paletteChecks(page, report))) return;
  await pressChecks(page, report, core);
  await refusalChecks(page, report, core);
}

/** The entry D17 put in the palette, and the hint that says what pressing it will cost. */
async function paletteChecks(page, report) {
  if (!(await openPalette(page, report, 'morn'))) return false;
  const list = await paletteText(page);
  const offered = /launch morning/iu.test(list);
  report.check('the palette offers the group, labelled to launch it', offered, list);
  // The only palette entry that spends quota, so the count is the last place to change your mind.
  report.check('and says how many presets the press will start', list.includes('2 presets'), list);
  if (!offered) await page.keyboard.press('Escape');
  return offered;
}

/** Enter, and what core was actually sent. */
async function pressChecks(page, report, core) {
  const before = core.groupPresses.length;
  await page.keyboard.press('Enter');
  const pressed = await waitFor(() => core.groupPresses.length === before + 1);
  report.check(
    'pressing it asks core to launch the group',
    pressed,
    String(core.groupPresses.at(-1)),
  );
  report.check(
    'it sends the NAME and nothing else — the folders come from presets core already screened',
    core.groupPresses.at(-1) === 'morning',
    String(core.groupPresses.at(-1)),
  );

  const banner = page.locator('[data-group-banner]');
  const shown = await waitFor(async () => (await banner.count()) === 1);
  report.check('the deck says what the press did', shown);
  if (!shown) return;

  const text = clean(await banner.first().textContent());
  report.check(
    'it reports a PARTIAL success rather than a yes or a no',
    text.includes('1 of 2'),
    text,
  );
  report.check('and names the preset that did not start', text.includes('orchestrator'), text);

  await page.locator('[data-group-dismiss]').first().click();
  const gone = await waitFor(async () => (await page.locator('[data-group-banner]').count()) === 0);
  report.check('the banner can be dismissed — it is news, not a fault', gone);
}

/**
 * A group core no longer has.
 *
 * The presets are cleared behind the deck's back, which is what another tab forgetting them looks
 * like from here: the palette still offers the entry it was drawn with, and the press has to come
 * back as a sentence rather than as a code or a silence.
 */
async function refusalChecks(page, report, core) {
  const before = core.groupPresses.length;
  core.presets.clear();

  if (!(await openPalette(page, report, 'morn'))) return;
  await page.keyboard.press('Enter');

  const banner = page.locator('[data-group-banner]');
  const refused = await waitFor(async () => (await banner.count()) === 1);
  const text = clean(await banner.first().textContent());
  report.check(
    'a group core no longer has is refused in English, not as a code',
    refused && text.toLowerCase().includes('no preset carries that group name'),
    text,
  );
  report.check('and core recorded no press for it', core.groupPresses.length === before);
}

/**
 * Ctrl+K, and a REPORTED failure rather than a thrown one.
 *
 * A `fill` on a locator that never appears throws thirty seconds later and takes the whole run
 * down with it — which is what happened, and which hid every check after this group. The scoreboard
 * exists so one failure does not hide the thirty after it (`report.mjs`), and a helper that throws
 * opts out of that.
 */
async function openPalette(page, report, query) {
  await page.keyboard.press('Control+k');
  const open = await waitFor(async () => (await page.locator('.palette-input').count()) > 0, {
    timeout: 10_000,
  });
  report.check('Ctrl+K opens the palette', open);
  if (!open) return false;
  await page.locator('.palette-input').fill(query);
  return true;
}

async function paletteText(page) {
  const text = await page
    .locator('.palette-list')
    .innerText()
    .catch(() => '');
  return clean(text);
}

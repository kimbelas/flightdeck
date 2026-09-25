// The workflow map is pressable — P9-T2.
//
// One check group per asset kind against the fixture map (`workflowMap` in fixture-core.mjs: the
// agent `german-ui-expert`, the command `design-check`, the skill `fix-review`). What no unit test
// can see is the hop between two panels: a button inside the map's `<details>` fills the presets
// editor above it, the caret lands after the slash line, and **the press itself sends nothing** —
// no save, no launch — until the owner presses save or start in the editor.
import { waitFor } from './report.mjs';
import { PROJECT } from './project-checks.mjs';

const AGENT = 'german-ui-expert';

/**
 * @param section the project row's `section.presets`, with its four built-ins and nothing saved.
 * Left in that state: the one preset saved here is forgotten again before returning.
 */
export async function mapPresetChecks(page, report, core, section) {
  report.group('Workflow map — make a preset from a row (P9-T2)');
  await page.locator('.project-map > summary').click();
  await waitFor(() => page.locator('.map-make').first().isVisible());
  report.check(
    'every agent, command and skill row offers make a preset',
    (await page.locator('.map-make').count()) === 3,
  );

  await skillChecks(page, report, core, section);
  await commandChecks(page, report, section);
  await agentDraftChecks(page, report, core, section);

  await page.locator('.project-map > summary').click();
}

/** Writes and launches since `mark` — the press must add neither. */
function writesSince(core, mark) {
  return core.requests
    .slice(mark)
    .filter(
      (request) =>
        request.method === 'POST' &&
        (request.path === '/projects/presets' || request.path === '/sessions'),
    ).length;
}

async function skillChecks(page, report, core, section) {
  const mark = core.requests.length;
  await page.locator('[data-map-make="skill:fix-review"]').click();
  const opened = await waitFor(async () => (await section.locator('.preset-draft').count()) === 1);
  report.check('a skill opens a draft in the presets editor', opened);
  if (!opened) return;
  report.check(
    'its prompt is the slash line, and the session is named after it',
    (await page.inputValue('.preset-prompt')) === '/fix-review ' &&
      (await page.inputValue('.preset-session-name')) === 'fix-review',
    await page.inputValue('.preset-prompt'),
  );
  const caret = await page.evaluate(() => {
    const box = document.activeElement;
    return box instanceof HTMLTextAreaElement && box.classList.contains('preset-prompt')
      ? box.selectionStart === box.value.length
      : false;
  });
  report.check('the cursor waits after it, in the focused prompt', caret);
  report.check(
    'the draft says it is not saved, and has nothing to forget',
    ((await section.locator('.preset-draft').textContent()) ?? '').includes('skill fix-review') &&
      (await section.locator('.preset-forget').count()) === 0,
  );
  report.check('the press itself wrote and started nothing', writesSince(core, mark) === 0);

  await page.locator('.preset-prompt').pressSequentially('42');
  const before = core.launches.length;
  await section.locator('.preset-start').click();
  await waitFor(() => core.launches.length === before + 1);
  const body = core.launches.at(-1) ?? {};
  report.check(
    'start sends the slash line on claude-365, in the project root, with no agent',
    body.prompt === '/fix-review 42' &&
      body.profileFn === 'claude-365' &&
      body.cwd === PROJECT &&
      body.name === 'fix-review' &&
      body.agent === undefined,
    `${String(body.profileFn)} ${String(body.prompt)}`,
  );
}

async function commandChecks(page, report, section) {
  await page.locator('[data-map-make="command:design-check"]').click();
  const drafted = await waitFor(
    async () => (await page.inputValue('.preset-prompt')) === '/design-check ',
  );
  report.check('a command becomes its own slash line, replacing the last draft', drafted);
  report.check(
    'and says which command it came from',
    ((await section.locator('.preset-draft').textContent()) ?? '').includes('command design-check'),
  );
}

async function agentDraftChecks(page, report, core, section) {
  const mark = core.requests.length;
  await page.locator(`[data-map-make="agent:${AGENT}"]`).click();
  const drafted = await waitFor(
    async () => (await section.locator('.preset-agent').inputValue()) === AGENT,
  );
  report.check('an agent opens a draft with that agent selected', drafted);
  report.check(
    'and leaves the prompt for the owner to write, so it cannot start yet',
    (await page.inputValue('.preset-prompt')) === '' &&
      (await section.locator('.preset-start').isDisabled()),
  );
  report.check('that press wrote nothing either', writesSince(core, mark) === 0);

  await section.locator('.preset-save').click();
  const saved = await waitFor(() => [...core.presets.values()].some((held) => held.id === AGENT));
  const held = [...core.presets.values()].find((preset) => preset.id === AGENT) ?? {};
  report.check(
    'save keeps the draft at core, agent and all',
    saved && held.agent === AGENT && held.profileFn === 'claude-365',
    `${String(held.profileFn)} --agent ${String(held.agent)}`,
  );

  await section.locator('.preset-chip', { hasText: AGENT }).click();
  report.check(
    'pressing a chip drops the draft for the preset core now holds',
    await waitFor(async () => (await section.locator('.preset-draft').count()) === 0),
  );
  await section.locator('.preset-forget').click();
  const back = await waitFor(async () => (await section.locator('.preset-chip').count()) === 4);
  report.check('forgetting it leaves the four built-ins', back && core.presets.size === 0);
}

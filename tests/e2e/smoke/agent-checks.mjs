// An agent on a preset — P9-T1, DECISIONS.md D59.
//
// The select is drawn from the project's own `.claude/agents` roster (`agentRoster` over the
// workflow map), and the fixture core applies core's rules to what arrives: shape, the function
// that pins its own agent, and the roster of the folder the session would start in. So a select
// that offered a name core would refuse, or a launch that dropped the field, fails here rather
// than on the owner's first press.
//
// The fixture map's roster is one agent, `german-ui-expert` (`workflowMap` in fixture-core.mjs).
import { waitFor } from './report.mjs';

const AGENT = 'german-ui-expert';

/**
 * @param section the project row's `section.presets`, with its four built-ins and nothing saved.
 * Left in that state: the one preset saved here is forgotten again before returning.
 */
export async function agentChecks(page, report, core, section) {
  report.group('Presets — an agent from the project roster (P9-T1)');

  await section.locator('.preset-chip', { hasText: 'orchestrator' }).click();
  await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);
  report.check(
    'claude-isg-orch draws no agent select, because it runs its own',
    (await section.locator('.preset-agent').count()) === 0 &&
      (await section.locator('.preset-where').textContent())?.includes('runs its own agent') ===
        true,
  );

  await section.locator('.preset-chip', { hasText: '365' }).click();
  const drawn = await waitFor(async () => (await section.locator('.preset-agent').count()) === 1);
  report.check('a function that does not pin one draws the select', drawn);
  if (!drawn) return;

  const options = await section
    .locator('.preset-agent option')
    .evaluateAll((all) => all.map((option) => option.value));
  report.check(
    'it offers none first, then exactly the roster',
    // P9-T5: a plugin agent is on the roster under its scoped name.
    options.join('|') === `|${AGENT}|shell-review:bash-script-auditor`,
    options.join('|'),
  );
  report.check(
    'and a built-in starts on none',
    (await section.locator('.preset-agent').inputValue()) === '',
  );

  await launchChecks(page, report, core, section);
  await saveChecks(page, report, core, section);
}

/** What a press sends with and without an agent chosen. */
async function launchChecks(page, report, core, section) {
  await page.fill('.preset-prompt', 'translate the settings page');
  await section.locator('.preset-agent').selectOption(AGENT);
  const before = core.launches.length;
  await section.locator('.preset-start').click();
  const started = await waitFor(() => core.launches.length === before + 1);
  report.check('a press with an agent reaches core and is accepted', started);
  const body = core.launches.at(-1) ?? {};
  report.check(
    'the launch carries the agent beside the function',
    body.agent === AGENT && body.profileFn === 'claude-365',
    `${String(body.profileFn)} --agent ${String(body.agent)}`,
  );

  await section.locator('.preset-agent').selectOption('');
  await section.locator('.preset-start').click();
  await waitFor(() => core.launches.length === before + 2);
  report.check('choosing none sends no agent', core.launches.at(-1)?.agent === undefined);
}

/** Saving a preset with an agent, reading it back into the select, and forgetting it. */
async function saveChecks(page, report, core, section) {
  await section.locator('.preset-agent').selectOption(AGENT);
  await page.fill('.preset-save-name', 'translate');
  await section.locator('.preset-save').click();
  const saved = await waitFor(() =>
    [...core.presets.values()].some((held) => held.id === 'translate'),
  );
  const held = [...core.presets.values()].find((preset) => preset.id === 'translate') ?? {};
  report.check('saving keeps the agent at core', saved && held.agent === AGENT, String(held.agent));

  await section.locator('.preset-chip', { hasText: 'translate' }).click();
  const selected = await waitFor(
    async () => (await section.locator('.preset-agent').inputValue()) === AGENT,
  );
  report.check('the saved preset opens with its agent selected', selected);

  await section.locator('.preset-forget').click();
  const back = await waitFor(async () => (await section.locator('.preset-chip').count()) === 4);
  report.check('forgetting it leaves the four built-ins', back && core.presets.size === 0);
}

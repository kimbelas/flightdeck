// Connect and Disconnect from the deck, with the dry run in between — P4-T6.
//
// The claim under test is D13's, and it is the one claim in this repo that is about the owner's
// own live Claude Code config: **the whole diff is on screen before a byte moves, and Disconnect
// puts every byte back.** So these checks are not "a button exists" — they read the rendered diff,
// then read what the far side of the wire HOLDS afterwards, and the last one compares it byte for
// byte with what it started as, CRLF included.
//
// Nothing here touches `~/.claude*`. `FixtureCore.connectFiles` is a Map, and it is planned over by
// core's own `ConnectPlanner` and patched by the real `StatuslinePatcher`, so what the deck renders
// is the plan core would produce (D35).
import { CONNECTED_EVENTS } from '../../../contracts/connect-plan.ts';
import { waitFor } from './report.mjs';

const SETTINGS_365 = String.raw`C:\cfg\.claude-365\settings.json`;
const SETTINGS_ISG = String.raw`C:\cfg\.claude-isg\settings.json`;
const STATUSLINE = String.raw`C:\cfg\.claude\hooks\statusline.py`;

export async function connectChecks(page, report, core) {
  report.group('Connect / Disconnect, with the dry run first (P4-T6)');
  const before = new Map(core.connectFiles);

  await page.locator('[aria-label="installation 365"]').click();
  const panel = page.locator('[data-connect-panel]');
  report.check('the installation panel carries the wiring panel', await panel.isVisible());

  const blurb = (await panel.locator('.install-note').first().allTextContents()).join(' ');
  report.check(
    'which names the hook events Connect actually installs, from the same constant',
    CONNECTED_EVENTS.every((event) => blurb.includes(event)),
    blurb.slice(0, 150),
  );
  report.check(
    'nothing can be written before a plan has been shown',
    (await page.locator('[data-connect-write]').count()) === 0,
  );

  await connectPlanShown(page, report);
  await connectWritten(page, report, core);
  await alreadyConnected(page, report);
  await disconnectRestores(page, report, core, before);

  await page.locator('[aria-label="close installation"]').click();
}

/** The diff itself — three files, and the hooks block visible as added lines. */
async function connectPlanShown(page, report) {
  await press(page, 'show what connecting would write');
  const shown = await waitFor(async () => (await page.locator('[data-connect-plan]').count()) > 0);
  report.check('the plan arrives from core', shown);

  const summaries = await page.locator('[data-connect-plan] summary').allTextContents();
  report.check(
    'and names every file it would rewrite — both subscriptions and the shared statusline',
    [SETTINGS_365, SETTINGS_ISG, STATUSLINE].every((path) =>
      summaries.some((line) => line.includes(path)),
    ),
    summaries.join(' | '),
  );

  const diffs = await page.locator('[data-connect-diff]').allTextContents();
  const diffFor = (wanted) => diffs[summaries.findIndex((line) => line.includes(wanted))] ?? '';
  const settings = diffFor(SETTINGS_365);
  report.check(
    '365’s settings diff is a unified diff of added lines, not the whole file re-printed',
    settings.includes('@@') && settings.split('\n').some((line) => line.startsWith('+')),
    settings.replaceAll(/\s+/gu, ' ').slice(0, 110),
  );
  report.check(
    'it shows the hooks block going in, addressed at core',
    settings.includes('127.0.0.1:4950/hooks') && settings.includes('"allowedEnvVars"'),
  );
  // SEC-DATA-4. The header is a NAME; a diff carrying the key itself would be a credential on a
  // screen and in whatever anyone pastes it into.
  report.check(
    'and the Authorization header is the variable NAME, never a key',
    settings.includes('Bearer ${FLIGHTDECK_TOKEN}'),
    (settings.split('\n').find((line) => line.includes('Bearer')) ?? '').trim(),
  );

  const python = diffFor(STATUSLINE);
  report.check(
    'the statusline diff is the marked block, which is what Disconnect deletes again',
    python.includes('flightdeck begin') && python.includes('flightdeck end'),
    python.replaceAll(/\s+/gu, ' ').slice(0, 110),
  );

  const step = (await page.locator('[data-connect-environment]').allTextContents())[0] ?? '';
  report.check(
    'the environment step is part of the plan — hooks without the key are a 401 per turn (F.1.6)',
    step.startsWith('publish') && step.includes('FLIGHTDECK_TOKEN'),
    step,
  );
}

/** Pressing it, and what the far side of the wire holds afterwards. */
async function connectWritten(page, report, core) {
  await page.locator('[data-connect-write]').click();
  const wrote = await waitFor(async () => (await page.locator('[data-connect-wrote]').count()) > 0);
  report.check('writing it reports what it did', wrote);

  const backups = await page.locator('[data-connect-backup]').allTextContents();
  report.check(
    'naming a backup for every file it replaced',
    backups.length === 3 && backups.every((line) => line.includes('.bak-')),
    backups.join(' | ').slice(0, 140),
  );

  // What core HOLDS, not what the page drew: the page could say anything.
  report.check(
    'and core now holds a hooks block in both subscriptions',
    [SETTINGS_365, SETTINGS_ISG].every((path) =>
      (core.connectFiles.get(path) ?? '').includes('127.0.0.1:4950/hooks'),
    ),
  );
  report.check(
    'the shared statusline.py is patched once, for both of them',
    (core.connectFiles.get(STATUSLINE) ?? '').includes('flightdeck begin'),
  );
  report.check(
    'and the ingest key is published, so a session started afterwards can authenticate',
    core.ingestKeyPublished,
  );
}

/** The ordinary state of the owner's machine: already connected, nothing to press. */
async function alreadyConnected(page, report) {
  await press(page, 'show what connecting would write');
  const settled = await waitFor(
    async () => (await page.locator('[data-connect-nothing]').count()) > 0,
  );
  const sentence = (await page.locator('[data-connect-nothing]').allTextContents())[0] ?? '';
  report.check(
    'asking again says there is nothing to do rather than offering a write that moves nothing',
    settled && sentence.includes('already connected'),
    sentence,
  );
  report.check(
    'and draws no write button at all in that state',
    (await page.locator('[data-connect-write]').count()) === 0,
  );
}

/** The load-bearing half: byte for byte, CRLF included (RESEARCH.md G.13). */
async function disconnectRestores(page, report, core, before) {
  await press(page, 'show what disconnecting would remove');
  const shown = await waitFor(async () => (await page.locator('[data-connect-write]').count()) > 0);
  report.check('the reverse plan is offered the same way — diff first', shown);

  await page.locator('[data-connect-write]').click();
  const done = await waitFor(async () => (await page.locator('[data-connect-wrote]').count()) > 0);
  report.check('and pressing it reports the same way', done);

  for (const [path, original] of before) {
    const now = core.connectFiles.get(path);
    report.check(
      `disconnect restored ${path.split('\\').slice(-2).join('\\')} byte for byte`,
      now === original,
      now === original
        ? `${String((now ?? '').length)} bytes, unchanged`
        : firstDifference(original, now),
    );
  }
  // EVERY line ending, not "a `\r\n` somewhere": the first version of this check asked whether the
  // isg file contained one, and a sabotage that re-printed the whole file in LF still left the
  // trailing `\r\n` behind and sailed past it. That is G.13's bug exactly — a whole-file rewrite
  // that keeps one line of the original — so the check has to count.
  const isg = core.connectFiles.get(SETTINGS_ISG) ?? '';
  const crlf = (text) => [(text.match(/\n/gu) ?? []).length, (text.match(/\r\n/gu) ?? []).length];
  const [lines, endings] = crlf(isg);
  report.check(
    'including EVERY line ending the isg file uses, which the 365 one does not (G.13)',
    lines > 0 && lines === endings && !(core.connectFiles.get(SETTINGS_365) ?? '').includes('\r'),
    `${String(endings)} of ${String(lines)} isg line endings are CRLF`,
  );
  report.check('and the ingest key is withdrawn with it', core.ingestKeyPublished === false);
}

function press(page, label) {
  return page.locator('[data-connect-panel] button', { hasText: label }).first().click();
}

/** Where two versions of a file first disagree — a failure worth reading rather than "false". */
function firstDifference(expected, actual) {
  const text = actual ?? '(absent)';
  for (let index = 0; index < Math.max(expected.length, text.length); index += 1) {
    if (expected[index] !== text[index]) {
      return `differs at ${String(index)}: ${JSON.stringify(expected.slice(index, index + 24))} vs ${JSON.stringify(text.slice(index, index + 24))}`;
    }
  }
  return 'lengths differ';
}

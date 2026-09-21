// Two live sessions in one working tree, on two accounts — P6-T5, SPEC §5.6.
//
// **The fixture deliberately does not contain this shape**, so the snapshot is pushed rather than
// read: the 365 sessions all live in `ledger` and the isg ones in `atlas`, which is what a healthy
// machine looks like. Editing the fixture to make it unhealthy would make every other group in the
// run assert against a machine with a warning on it.
//
// What is checked here is the half a unit test cannot see: that the warning is on the COLLAPSED
// row. `duplicate-cwd.test.ts` settles when it fires; this settles that somebody who was not
// looking for it would find it, which is the whole point — `claude agents` reads one config
// directory, so neither account's own listing mentions the other's session in the folder.
import { waitFor } from './report.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

export async function duplicateCwdChecks(page, report, core) {
  report.group('Two accounts in one folder (P6-T5)');

  const rows = core.fixture.snapshot.rows;
  const shared = rows.find((row) => row.subscription === '365' && row.live);
  const other = rows.find((row) => row.subscription === 'isg' && row.live);
  if (shared === undefined || other === undefined) {
    report.check('the fixture has a live session on each subscription', false);
    return;
  }

  await page.locator('[data-project-all]').click();
  const before = await page.locator('[data-row-shared-tree]').count();
  report.check('a healthy machine shows no warning at all', before === 0, String(before));

  // The isg session moves into the 365 session's folder. Nothing else changes.
  const moved = rows.map((row) => (row === other ? { ...row, cwd: shared.cwd } : row));
  core.publish('snapshot', { ...core.fixture.snapshot, rows: moved });
  // Derived, not hardcoded: the fixture has THREE live 365 sessions in that folder, so moving one
  // isg session into it makes four sessions sharing one working tree — and all four are warned,
  // because the warning is about the tree rather than about which pair differ.
  const sharing = moved.filter((row) => row.live && row.cwd === shared.cwd).length;

  const tag = page.locator('[data-row-shared-tree]');
  const warned = await waitFor(async () => (await tag.count()) > 0);
  report.check('the deck warns when two accounts are live in one folder', warned);
  if (!warned) return;

  report.check(
    'it warns EVERY live session in that folder, not just the pair that differ',
    (await tag.count()) === sharing,
    `${String(await tag.count())} of ${String(sharing)} sharing`,
  );
  report.check(
    'the warning is on the collapsed row — nobody goes looking for this one',
    (await page.locator('.row-open [data-row-shared-tree]').count()) === 0,
  );
  report.check(
    'and it names the other account, which is the window to go and look in',
    clean(await tag.first().getAttribute('title')).includes('Also running on'),
    clean(await tag.first().getAttribute('title')),
  );

  // Back to the machine every other group is written against.
  core.publish('snapshot', core.fixture.snapshot);
  const cleared = await waitFor(async () => (await tag.count()) === 0);
  report.check('and it goes away when they are no longer sharing one', cleared);
}

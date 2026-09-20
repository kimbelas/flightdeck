// P5a-T7, SEC-FS-3. The planner owns the contents; this owns the ORDER — back up before replacing,
// and never back up a file that is not there.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SUBSCRIPTION_IDS } from '../../../contracts/session.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { KEYBINDINGS_FILE, KeybindingHelper } from '../../../core/application/keybinding-helper.ts';
import { FakeConfigFile } from '../../fakes/fake-config-file.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const HOME = String.raw`C:\home`;
const PATH_365 = join(HOME, '.claude-365', KEYBINDINGS_FILE);
const PATH_ISG = join(HOME, '.claude-isg', KEYBINDINGS_FILE);
/** Both files, in the order `SUBSCRIPTION_IDS` gives — read off the contract, never assumed. */
const BOTH: readonly string[] = SUBSCRIPTION_IDS.map((id) => (id === '365' ? PATH_365 : PATH_ISG));

function helper(initial: Readonly<Record<string, string>> = {}): {
  helper: KeybindingHelper;
  files: FakeConfigFile;
  logger: FakeLogger;
} {
  const files = new FakeConfigFile(initial);
  const logger = new FakeLogger();
  const install = new ClaudeInstall(HOME, '');
  return { helper: new KeybindingHelper({ install, files, logger }), files, logger };
}

describe('KeybindingHelper', () => {
  it('plans against both config dirs, by subscription and never by a supplied path', () => {
    const { helper: subject } = helper();
    const plan = subject.plan('apply');

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.map((change) => change.path)).toEqual(BOTH);
  });

  it('creates a missing file WITHOUT a backup, because there is nothing to back up', () => {
    const { helper: subject, files } = helper();
    const written = subject.write('apply');

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.backups).toEqual([]);
    expect(files.operations).toEqual(BOTH.map((path) => `create ${path}`));
  });

  it('backs an existing file up BEFORE replacing it, in that order', () => {
    const { helper: subject, files } = helper({ [PATH_365]: '{"bindings":[]}' });
    const written = subject.write('apply');

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(files.operations).toEqual(
      BOTH.flatMap((path) =>
        path === PATH_365 ? [`backup ${path}`, `write ${path}`] : [`create ${path}`],
      ),
    );
    expect(written.value.backups).toEqual([`${PATH_365}.bak-fake`]);
  });

  it('writes nothing at all when one file refuses', () => {
    const { helper: subject, files } = helper({ [PATH_ISG]: 'not json' });
    const written = subject.write('apply');

    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error[0]?.path).toBe(PATH_ISG);
    expect(files.operations).toEqual([]);
  });

  it('is reversible — restore puts both files back to what they were', () => {
    const before =
      '{\n  "bindings": [\n    {\n      "context": "Chat",\n      "bindings": {\n        "ctrl+e": "chat:externalEditor"\n      }\n    }\n  ]\n}\n';
    const { helper: subject, files } = helper({ [PATH_365]: before, [PATH_ISG]: before });

    expect(subject.write('apply').ok).toBe(true);
    expect(files.read(PATH_365)).not.toBe(before);
    expect(subject.write('restore').ok).toBe(true);
    expect(files.read(PATH_365)).toBe(before);
    expect(files.read(PATH_ISG)).toBe(before);
  });

  it('does nothing a second time, and says so', () => {
    const { helper: subject, files } = helper();
    subject.write('apply');
    const operations = files.operations.length;

    const again = subject.write('apply');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.written).toEqual([]);
    expect(again.value.alreadyDone).toEqual(BOTH);
    expect(files.operations).toHaveLength(operations);
  });

  it('logs that it wrote, without logging what', () => {
    const { helper: subject, logger } = helper();
    subject.write('apply');
    expect(logger.logged('keybindings_written')).toBe(true);
  });
});

// SPEC §5.1's first row — five stats, two of them outside the project (P3-T3, SEC-FS-1).
//
// **The case worth the most here is the user `CLAUDE.md`.** It lives under a config directory,
// where the rules are ALLOW-list rather than deny-list, so it is readable only because `ReadPolicy`
// names it (DECISIONS.md D38). A fake that let it through by containment would prove nothing — so
// this file's fake screens a config-directory path the way `ReadPolicy` does, by the one name, and
// there is a case asserting that a SIBLING of it is refused. That is the lesson G.26 charged for:
// a fake can only be as strict as its author remembered the collaborator's rule to be.
import { beforeEach, describe, expect, it } from 'vitest';
import { InstructionStackReader } from '../../../core/application/instruction-stack-reader.ts';
import { canonicalWindowsPath, childPath, isUnder } from '../../../contracts/windows-path.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';

const ROOT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const C365 = 'C:\\Users\\belas\\.claude-365';
const ISG = 'C:\\Users\\belas\\.claude-isg';

/**
 * The real `ReadPolicy` behind the one door, which is the point of this fake.
 *
 * `ProjectRegistry.resolve` canonicalises and then screens with exactly this class; a fake that
 * substituted its own rule would test the reader against a policy nobody ships.
 */
class PolicyPaths {
  public readonly asked: string[] = [];
  private readonly policy = new ReadPolicy([C365, ISG], [ROOT]);

  public resolve(path: string): Promise<Result<string, string>> {
    this.asked.push(path);
    const refusal = this.policy.refusal(path);
    return Promise.resolve(refusal === undefined ? ok(path) : err(refusal));
  }
}

let files: FakeProjectFiles;
let paths: PolicyPaths;
let reader: InstructionStackReader;

beforeEach(() => {
  files = new FakeProjectFiles();
  paths = new PolicyPaths();
  reader = new InstructionStackReader({
    paths,
    files,
    configDirs: { '365': C365, isg: ISG },
  });
});

describe('read', () => {
  it('answers every source in resolution order, present or not', async () => {
    const stack = await reader.read(ROOT);
    expect(stack.map((file) => file.source)).toEqual([
      'user-365',
      'user-isg',
      'claude-md',
      'agents-md',
      'soul-md',
    ]);
  });

  it('reports the size of each file that is there', async () => {
    files.file(childPath(ROOT, 'CLAUDE.md'), 'x'.repeat(3482));
    files.file(childPath(childPath(ROOT, '.claude'), 'soul.md'), 'y'.repeat(120));
    const stack = await reader.read(ROOT);
    expect(stack.find((file) => file.source === 'claude-md')?.bytes).toBe(3482);
    expect(stack.find((file) => file.source === 'soul-md')?.bytes).toBe(120);
    expect(stack.find((file) => file.source === 'agents-md')?.bytes).toBeUndefined();
  });

  it('reads the user CLAUDE.md of BOTH config dirs — the one D38 allowlisted', async () => {
    files.file(childPath(C365, 'CLAUDE.md'), 'z'.repeat(683));
    files.file(childPath(ISG, 'CLAUDE.md'), 'z'.repeat(683));
    const stack = await reader.read(ROOT);
    expect(stack.find((file) => file.source === 'user-365')?.bytes).toBe(683);
    expect(stack.find((file) => file.source === 'user-isg')?.bytes).toBe(683);
  });

  it('does not open anything — a stack is five stats', async () => {
    files.file(childPath(ROOT, 'CLAUDE.md'), 'x'.repeat(3482));
    await reader.read(ROOT);
    // The largest file in the stack is the one it would be most expensive to read, and nothing
    // here needs its contents.
    expect(files.listed).toEqual([]);
  });

  it('reports a directory named CLAUDE.md as absent rather than as a file', async () => {
    files.directory(childPath(ROOT, 'CLAUDE.md'), ['nope.md']);
    const stack = await reader.read(ROOT);
    expect(stack.find((file) => file.source === 'claude-md')?.bytes).toBeUndefined();
  });

  it('reports a refused file as absent, without saying which rule refused it', async () => {
    // A `soul.md` that is not there, one on an unplugged drive, and one core may not open all mean
    // the same thing to somebody reading a stack: that file is not speaking here.
    const outside = new InstructionStackReader({
      paths,
      files,
      configDirs: { '365': C365, isg: ISG },
    });
    const stack = await outside.read('C:\\Users\\belas\\Documents\\development\\not-imported');
    expect(stack.every((file) => file.bytes === undefined)).toBe(true);
  });
});

describe('the config-directory rule the stack depends on', () => {
  const policy = new ReadPolicy([C365, ISG], [ROOT]);

  it('allows the one file D38 named', () => {
    expect(policy.allows(childPath(C365, 'CLAUDE.md'))).toBe(true);
    expect(policy.allows(childPath(ISG, 'CLAUDE.md'))).toBe(true);
  });

  it('still refuses every sibling of it', () => {
    // The wrong fix would have been allowlisting the config directory's top level, or `*.md` under
    // it — which would make the next release's new markdown file readable by default.
    expect(policy.allows(childPath(C365, 'AGENTS.md'))).toBe(false);
    expect(policy.allows(childPath(C365, 'soul.md'))).toBe(false);
    expect(policy.allows(childPath(C365, 'stats-cache.json'))).toBe(false);
    expect(policy.allows(childPath(childPath(C365, 'daemon'), 'control.key'))).toBe(false);
  });

  it('is a name and not a suffix — a CLAUDE.md deeper in is still refused', () => {
    expect(policy.allows(childPath(childPath(C365, 'plugins'), 'CLAUDE.md'))).toBe(false);
  });

  it('is not what makes the project copy readable — D36 already did', () => {
    expect(policy.allows(childPath(ROOT, 'CLAUDE.md'))).toBe(true);
    expect(policy.allows(childPath(ROOT, 'AGENTS.md'))).toBe(true);
    expect(isUnder(canonicalWindowsPath(childPath(ROOT, 'CLAUDE.md')), ROOT.toLowerCase())).toBe(
      true,
    );
  });
});

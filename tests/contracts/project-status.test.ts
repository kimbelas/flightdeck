// Stack detection and the status wire shape — P3-T2, SPEC §5.1.
//
// The detector is deliberately shallow: it looks at the NAMES of the entries at a project root and
// opens nothing. That is what makes it testable with an array of strings, and it is also the
// boundary — reading dependencies out of `package.json` would make this a JSON parse of a file an
// imported repository controls, on every refresh, for a label.
import { describe, expect, it } from 'vitest';
import {
  detectStack,
  parseProjectStatus,
  parseProjectStatusList,
  STACK_LABELS,
} from '../../contracts/project-status.ts';

const ROOT = 'C:\\Users\\belas\\Documents\\development\\app-next';

describe('detectStack', () => {
  it('reads a Node project off package.json', () => {
    expect(detectStack(['package.json', 'src', 'README.md'])).toEqual(['Node']);
  });

  it('reads Next.js off any of the config extensions it is written in', () => {
    for (const config of [
      'next.config.ts',
      'next.config.mjs',
      'next.config.cjs',
      'next.config.js',
    ]) {
      expect(detectStack([config])).toEqual(['Next.js']);
    }
  });

  it('names the framework before the runtime when a repository has both', () => {
    // "Next.js · Node" reads as the specific answer followed by the general one. Both are true and
    // both are shown; the order is the decision.
    expect(detectStack(['package.json', 'next.config.ts'])).toEqual(['Next.js', 'Node']);
  });

  it('reads Angular, .NET and Docker off their own markers', () => {
    expect(detectStack(['angular.json'])).toEqual(['Angular']);
    expect(detectStack(['Flightdeck.Api.csproj'])).toEqual(['.NET']);
    expect(detectStack(['Dockerfile'])).toEqual(['Docker']);
  });

  it('counts Dockerfile.dev, because a repository with only that still builds a container', () => {
    expect(detectStack(['Dockerfile.prod'])).toEqual(['Docker']);
  });

  it('matches whatever casing the filesystem uses', () => {
    expect(detectStack(['PACKAGE.JSON', 'dockerfile'])).toEqual(['Docker', 'Node']);
  });

  it('answers nothing for a folder with no marker, which is an ordinary folder', () => {
    // SPEC §5.1's "degrades gracefully" half. A docs repository is not a failed read.
    expect(detectStack(['README.md', 'docs', '.git'])).toEqual([]);
  });

  it('does not mistake a marker-shaped name for a marker', () => {
    expect(detectStack(['package.json.bak', 'my-next.config.ts', 'nextconfig.ts'])).toEqual([]);
  });

  it('answers in one fixed order whatever order the directory was listed in', () => {
    const everything = ['Dockerfile', 'package.json', 'angular.json', 'a.csproj', 'next.config.ts'];
    expect(detectStack(everything)).toEqual([...STACK_LABELS]);
  });
});

describe('parseProjectStatus', () => {
  it('reads one reading off the wire', () => {
    const status = parseProjectStatus({
      path: ROOT,
      at: 1,
      stack: ['Node'],
      git: { branch: 'main', dirty: 2 },
    });
    expect(status).toMatchObject({ path: ROOT, at: 1, stack: ['Node'] });
    expect(status?.git).toMatchObject({ branch: 'main', dirty: 2 });
  });

  it('reads an absent git as no repository, which is how JSON carries `undefined`', () => {
    expect(parseProjectStatus({ path: ROOT, at: 1 })?.git).toBeUndefined();
  });

  it('refuses a reading with no path, because nothing could say which row it is about', () => {
    expect(parseProjectStatus({ at: 1 })).toBeUndefined();
    expect(parseProjectStatus({ path: ROOT })).toBeUndefined();
  });

  it('drops a stack label this build does not know rather than displaying it', () => {
    expect(parseProjectStatus({ path: ROOT, at: 1, stack: ['Node', 'COBOL'] })?.stack).toEqual([
      'Node',
    ]);
  });

  it('answers a fixed display order whatever order the wire used', () => {
    expect(parseProjectStatus({ path: ROOT, at: 1, stack: ['Node', 'Next.js'] })?.stack).toEqual([
      'Next.js',
      'Node',
    ]);
  });
});

describe('parseProjectStatusList', () => {
  it('reads the readings out of a `GET /projects/status` body', () => {
    const body = { statuses: [{ path: ROOT, at: 1, stack: [], git: undefined }] };
    expect(parseProjectStatusList(body)).toHaveLength(1);
  });

  it('drops what it cannot read rather than refusing the whole list', () => {
    // One unreadable row must not cost the deck the other nine — the rule every parser in
    // contracts/ follows.
    const body = { statuses: [{ path: ROOT, at: 1 }, { at: 2 }, 'nonsense'] };
    expect(parseProjectStatusList(body)).toHaveLength(1);
  });

  it('answers empty for a body that is not one, rather than throwing at a caller', () => {
    expect(parseProjectStatusList({ statuses: 'none' })).toEqual([]);
    expect(parseProjectStatusList(null)).toEqual([]);
  });
});

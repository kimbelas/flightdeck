// Reading an ACL back — the parser half of `WindowsFileAcl` (P1-T12, SEC-FS-4).
//
// `doctor` decides whether SEC-FS-4 holds from this output, so the parse is the control. The
// fixtures below are real `icacls` output shapes: the path shares the first line with the first
// ACE, a drive letter carries the same colon that separates the rights, an account name carries a
// backslash, and the last two lines are prose.
//
// The write half is not testable without a filesystem and is proven on windows-latest instead
// (tests/win/token-file.test.ts, tests/win/data-directory-acl.test.ts).
import { describe, expect, it } from 'vitest';
import { parseGrants, WindowsFileAcl } from '../../../core/adapters/windows/windows-file-acl.ts';

const FILE = 'C:\\Users\\dev\\AppData\\Local\\flightdeck\\token';

const RESTRICTED = `${FILE} KIMPOY\\Kimpoy:(F)

Successfully processed 1 files; Failed processing 0 files
`;

const INHERITED = `${FILE} NT AUTHORITY\\SYSTEM:(I)(F)
                                                     BUILTIN\\Administrators:(I)(F)
                                                     KIMPOY\\Kimpoy:(I)(F)

Successfully processed 1 files; Failed processing 0 files
`;

const DIRECTORY = `C:\\Users\\dev\\AppData\\Local\\flightdeck KIMPOY\\Kimpoy:(OI)(CI)(F)

Successfully processed 1 files; Failed processing 0 files
`;

describe('parseGrants', () => {
  it('reads the one grant off a restricted file', () => {
    expect(parseGrants(FILE, RESTRICTED)).toEqual([{ account: 'KIMPOY\\Kimpoy', rights: '(f)' }]);
  });

  it('reads every grant off an unrestricted file, including the inherited ones', () => {
    const grants = parseGrants(FILE, INHERITED);

    expect(grants.map((grant) => grant.account)).toEqual([
      'NT AUTHORITY\\SYSTEM',
      'BUILTIN\\Administrators',
      'KIMPOY\\Kimpoy',
    ]);
    // `(I)` says inherited, which is exactly what `/inheritance:r` removes — so it must survive
    // the parse rather than be normalised away.
    expect(grants[0]?.rights).toBe('(i)(f)');
  });

  it('keeps a directory grant intact, inheritance flags and all', () => {
    const grants = parseGrants('C:\\Users\\dev\\AppData\\Local\\flightdeck', DIRECTORY);

    expect(grants).toEqual([{ account: 'KIMPOY\\Kimpoy', rights: '(oi)(ci)(f)' }]);
  });

  it('reads nothing out of the summary prose', () => {
    expect(parseGrants(FILE, 'Successfully processed 1 files; Failed processing 0 files')).toEqual(
      [],
    );
  });

  it('reads nothing out of an error, which is how a missing file arrives', () => {
    const error = `${FILE}: The system cannot find the file specified.
Successfully processed 0 files; Failed processing 1 files`;

    expect(parseGrants(FILE, error)).toEqual([]);
  });

  it('does not mistake a drive letter for an account', () => {
    // The trap: `C:` ends in the same colon the rights follow. An account of `C` with rights of
    // the rest of the path would make every check downstream pass on a file nobody restricted.
    const grants = parseGrants('', RESTRICTED);

    expect(grants).toHaveLength(1);
    expect(grants[0]?.account).toBe(`${FILE} KIMPOY\\Kimpoy`);
  });
});

describe('WindowsFileAcl when it is switched off', () => {
  const acl = new WindowsFileAcl(false);

  it('writes nothing, so a unit test on Linux does not die in a Windows adapter', () => {
    expect(() => {
      acl.restrictFile(FILE);
      acl.restrictDirectory(FILE);
    }).not.toThrow();
  });

  it('describes nothing, rather than claiming a path is restricted', () => {
    expect(acl.describe(FILE)).toEqual({ path: FILE, exists: false, grants: [] });
  });
});

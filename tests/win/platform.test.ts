import { describe, expect, it } from 'vitest';

// Windows-only integration tests land here (node-pty spawn/resize, path canonicalisation, ACLs).
// CI runs this folder on windows-latest; locally it runs on the owner's machine and is skipped elsewhere.
describe('windows platform', () => {
  it.skipIf(process.platform !== 'win32')('runs on win32', () => {
    expect(process.platform).toBe('win32');
  });
});

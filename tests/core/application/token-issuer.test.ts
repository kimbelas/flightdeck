// SEC-HTTP-3 — what "one token per boot" has to mean in practice.
import { describe, expect, it } from 'vitest';
import { TokenIssuer } from '../../../core/application/token-issuer.ts';
import { FakeTokenFile } from '../../fakes/fake-token-file.ts';

describe('TokenIssuer', () => {
  it('issues 256 bits of hex and publishes exactly that', () => {
    const file = new FakeTokenFile();

    const token = new TokenIssuer(file).issue();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(file.written).toBe(token);
  });

  it('never issues the same token twice', () => {
    const tokens = new Set<string>();
    for (let boot = 0; boot < 50; boot += 1) {
      tokens.add(new TokenIssuer(new FakeTokenFile()).issue());
    }
    expect(tokens.size).toBe(50);
  });

  it('propagates a write failure rather than running without a readable token', () => {
    const file = new FakeTokenFile();
    file.failOnWrite = true;

    expect(() => new TokenIssuer(file).issue()).toThrow('acl refused');
  });

  it('revokes by removing the file, so no token outlives the core that issued it', () => {
    const file = new FakeTokenFile();
    const issuer = new TokenIssuer(file);
    issuer.issue();

    issuer.revoke();

    expect(file.written).toBeUndefined();
    expect(file.removals).toBe(1);
  });
});

// SEC-HTTP-7 — the one secret Flightdeck does not rotate, and why "read or create" is the point.
import { describe, expect, it } from 'vitest';
import { IngestKeyIssuer } from '../../../core/application/ingest-key-issuer.ts';
import { FakeTokenFile } from '../../fakes/fake-token-file.ts';

describe('IngestKeyIssuer', () => {
  it('creates 256 bits of hex when there is nothing there yet', () => {
    const file = new FakeTokenFile();

    const key = new IngestKeyIssuer(file).ensure();

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(file.written).toBe(key);
  });

  it('returns the SAME key on the next boot, which is the whole control', () => {
    // A session interpolates its hook header once, at spawn (F.1.7). A key that changed here
    // would 401 every session that predates the restart — a banner per turn, per session.
    const file = new FakeTokenFile();

    const first = new IngestKeyIssuer(file).ensure();
    const second = new IngestKeyIssuer(file).ensure();

    expect(second).toBe(first);
  });

  it('does not rewrite the file when a key is already there', () => {
    const file = new FakeTokenFile();
    new IngestKeyIssuer(file).ensure();
    file.failOnWrite = true;

    expect(() => new IngestKeyIssuer(file).ensure()).not.toThrow();
  });

  it('propagates a write failure rather than returning a key sessions cannot read', () => {
    const file = new FakeTokenFile();
    file.failOnWrite = true;

    expect(() => new IngestKeyIssuer(file).ensure()).toThrow('acl refused');
  });

  it('rotate replaces it, for the deliberate SEC-OPS-2 action and nothing else', () => {
    const file = new FakeTokenFile();
    const issuer = new IngestKeyIssuer(file);
    const first = issuer.ensure();

    const rotated = issuer.rotate();

    expect(rotated).not.toBe(first);
    expect(file.written).toBe(rotated);
  });
});

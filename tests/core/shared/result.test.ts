// Result — the boundary between "predicted" and "bug" (CODING-STANDARDS §6).
import { describe, expect, it } from 'vitest';
import { err, ok, unwrap, type Result } from '../../../core/shared/result.ts';

describe('Result', () => {
  it('discriminates on ok, so a switch over it is exhaustive', () => {
    const results: readonly Result<number, string>[] = [ok(1), err('nope')];
    const seen = results.map((result) => (result.ok ? result.value : result.error));
    expect(seen).toEqual([1, 'nope']);
  });

  it('unwraps a value', () => {
    expect(unwrap(ok('yes'))).toBe('yes');
  });

  it('throws on an error, which is why use cases never call it', () => {
    expect(() => unwrap(err({ code: 'illegal_transition' }))).toThrow(/illegal_transition/);
  });
});

// The one duplicated value in the deck's routing, pinned to the contract it duplicates — P2-T1.
//
// `proxy.ts` cannot import its matcher. Next parses the `config` export out of the source at build
// time rather than evaluating it, so an imported constant is not a constant to it and `next build`
// fails with "Missing `source` in `matcher[0]` object". That is not a thing any unit test caught:
// the suite was green and the build was broken, which is RESEARCH.md §G in one line.
//
// So the literal stays in `proxy.ts` and this test holds it to `PROXIED_ROUTES`. Reading the file
// as text is the right level rather than a workaround — the source is what Next reads too, and
// importing `proxy.ts` here would drag `next/server` into the TypeScript project core/ is checked
// by (contracts/deck-routes.ts carries that argument).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROXIED_ROUTES } from '../../contracts/deck-routes.ts';

const PROXY_SOURCE = fileURLToPath(new URL('../../proxy.ts', import.meta.url));

/** The `source` string out of `export const config`, exactly as Next's static parse would take it. */
function declaredMatcher(): string | undefined {
  const text = readFileSync(PROXY_SOURCE, 'utf8');
  const config = /export const config = \{[^}]*matcher: \[\{ source: '(?<source>[^']*)' \}\]/u.exec(
    text,
  );
  return config?.groups?.['source'];
}

describe('proxy.ts — the matcher Next parses out of the source', () => {
  it('is a literal, because an imported constant fails the build', () => {
    expect(declaredMatcher()).toBeDefined();
  });

  it('is the same route set the contract describes and the tests above assert', () => {
    expect(declaredMatcher()).toBe(PROXIED_ROUTES);
  });
});

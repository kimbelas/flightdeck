// SEC-HTTP-3 — the token is the only thing between a page and a live core, so the two ways of
// getting it wrong are both tested: reading a token that is not there, and caching one that is.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachCoreToken, coreTokenFile, readCoreToken } from '../../contracts/core-token.ts';

const TOKEN = 'f'.repeat(64);

describe('coreTokenFile', () => {
  const saved = process.env['FD_TOKEN_FILE'];

  afterEach(() => {
    if (saved === undefined) delete process.env['FD_TOKEN_FILE'];
    else process.env['FD_TOKEN_FILE'] = saved;
  });

  it('lands in a flightdeck folder under LOCALAPPDATA by default', () => {
    delete process.env['FD_TOKEN_FILE'];
    expect(coreTokenFile().endsWith(join('flightdeck', 'token'))).toBe(true);
  });

  it('honours an override so a spike never writes over a running core token', () => {
    process.env['FD_TOKEN_FILE'] = join('C:', 'probe', 'token');
    expect(coreTokenFile()).toBe(join('C:', 'probe', 'token'));
  });

  it('treats an empty override as absent rather than as the empty path', () => {
    process.env['FD_TOKEN_FILE'] = '';
    expect(coreTokenFile().endsWith(join('flightdeck', 'token'))).toBe(true);
  });
});

describe('readCoreToken', () => {
  let directory = '';
  const saved = process.env['FD_TOKEN_FILE'];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fd-token-'));
    process.env['FD_TOKEN_FILE'] = join(directory, 'token');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (saved === undefined) delete process.env['FD_TOKEN_FILE'];
    else process.env['FD_TOKEN_FILE'] = saved;
  });

  it('is undefined when core has never run — absence is a state, not an error', () => {
    expect(readCoreToken()).toBeUndefined();
  });

  it('reads the token and trims the newline a text editor would add', () => {
    writeFileSync(join(directory, 'token'), `${TOKEN}\n`, 'utf8');
    expect(readCoreToken()).toBe(TOKEN);
  });

  it('treats an empty file as no token, so a half-written file fails closed', () => {
    writeFileSync(join(directory, 'token'), '   \n', 'utf8');
    expect(readCoreToken()).toBeUndefined();
  });

  it('sees a rotation without a restart — SEC-OPS-2 changes it while the deck is up', () => {
    writeFileSync(join(directory, 'token'), TOKEN, 'utf8');
    expect(readCoreToken()).toBe(TOKEN);
    writeFileSync(join(directory, 'token'), 'a'.repeat(64), 'utf8');
    expect(readCoreToken()).toBe('a'.repeat(64));
  });
});

describe('attachCoreToken', () => {
  it('attaches the bearer, so the page never has to hold one (SEC-HTTP-5)', () => {
    const headers = new Headers();

    attachCoreToken(headers, TOKEN);

    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('replaces a header the page put there rather than passing it through', () => {
    const headers = new Headers({ authorization: 'Bearer forged' });

    attachCoreToken(headers, TOKEN);

    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('strips a forged header when core is down — the delete is the fail-closed half', () => {
    // No token means core has never run, or has stopped. Without the delete, a script on the deck
    // page could put its own `Authorization` on a fetch and have it forwarded to core untouched
    // (SECURITY.md §3 rule 3). This is the one case the `set` above does not cover.
    const headers = new Headers({ authorization: 'Bearer forged' });

    attachCoreToken(headers, undefined);

    expect(headers.has('authorization')).toBe(false);
  });

  it('leaves every other header alone', () => {
    const headers = new Headers({ accept: 'text/event-stream' });

    attachCoreToken(headers, TOKEN);

    expect(headers.get('accept')).toBe('text/event-stream');
  });
});

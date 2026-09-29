// FD_CORE_PORT and FD_SUBSCRIPTIONS — P11-T0, DECISIONS.md D65.
//
// The headline is the first test: with neither variable set, a core is exactly what it was before
// P11. The rest pin that a present-but-wrong value refuses, because an outpost core that fell back
// to 4950 would answer a tunnel meant for another core.
import { describe, expect, it } from 'vitest';
import { CORE_PORT } from '../../contracts/origins.ts';
import { SUBSCRIPTION_IDS } from '../../contracts/session.ts';
import {
  LOCAL_CORE,
  clientCorePort,
  clientSubscriptions,
  corePortFrom,
  readCoreEnvironment,
  subscriptionsFrom,
} from '../../core/core-environment.ts';

describe('readCoreEnvironment', () => {
  it('is this machine, unchanged, when neither variable is set', () => {
    expect(readCoreEnvironment({})).toEqual({ ok: true, value: LOCAL_CORE });
    expect(LOCAL_CORE).toEqual({ port: CORE_PORT, subscriptions: SUBSCRIPTION_IDS });
  });

  it('reads an outpost: its own port and one subscription', () => {
    expect(readCoreEnvironment({ FD_CORE_PORT: '4951', FD_SUBSCRIPTIONS: '365' })).toEqual({
      ok: true,
      value: { port: 4951, subscriptions: ['365'] },
    });
  });

  it('reports the port problem before the subscription one', () => {
    const read = readCoreEnvironment({ FD_CORE_PORT: 'x', FD_SUBSCRIPTIONS: 'nope' });

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toContain('FD_CORE_PORT');
  });
});

describe('corePortFrom', () => {
  it.each([[undefined], [''], ['  ']])('treats %j as unset', (raw) => {
    expect(corePortFrom(raw)).toEqual({ ok: true, value: CORE_PORT });
  });

  it('accepts a port with spaces around it', () => {
    expect(corePortFrom(' 4952 ')).toEqual({ ok: true, value: 4952 });
  });

  it.each([
    ['80', 'not a port'],
    ['4951x', 'not a port'],
    ['-4951', 'not a port'],
    ['0x1353', 'not a port'],
    ['99999', 'outside'],
    ['4949', "deck's port"],
  ])('refuses %s', (raw, why) => {
    const port = corePortFrom(raw);

    expect(port.ok).toBe(false);
    if (!port.ok) expect(port.error).toContain(why);
  });
});

describe('subscriptionsFrom', () => {
  it('is every subscription when unset', () => {
    expect(subscriptionsFrom(undefined)).toEqual({ ok: true, value: SUBSCRIPTION_IDS });
  });

  it('keeps SUBSCRIPTION_IDS order whatever order it is written in', () => {
    expect(subscriptionsFrom('365, isg')).toEqual({ ok: true, value: ['isg', '365'] });
  });

  it.each([
    ['claude-365', 'not one of'],
    ['365,,isg', 'not one of'],
    ['365,365', 'twice'],
  ])('refuses %s', (raw, why) => {
    const hosted = subscriptionsFrom(raw);

    expect(hosted.ok).toBe(false);
    if (!hosted.ok) expect(hosted.error).toContain(why);
  });
});

describe('the client side', () => {
  it('asks the configured port, and 4950 when the value is one core would refuse', () => {
    expect(clientCorePort({ FD_CORE_PORT: '4951' })).toBe(4951);
    expect(clientCorePort({ FD_CORE_PORT: 'junk' })).toBe(CORE_PORT);
  });

  it('reads the configured subscriptions, and both when the value is wrong', () => {
    expect(clientSubscriptions({ FD_SUBSCRIPTIONS: 'isg' })).toEqual(['isg']);
    expect(clientSubscriptions({ FD_SUBSCRIPTIONS: 'junk' })).toEqual(SUBSCRIPTION_IDS);
  });
});

// The query helpers are the point — they let a test assert that a refusal was logged without
// asserting how it was worded, which is the difference between a test that survives a reword and
// one that does not.
import { describe, expect, it } from 'vitest';
import { FakeLogger } from './fake-logger.ts';

describe('FakeLogger', () => {
  it('keeps level, event and details apart', () => {
    const logger = new FakeLogger();

    logger.warn('request_denied', { reason: 'bad_token' });

    expect(logger.last).toEqual({
      level: 'warn',
      event: 'request_denied',
      details: { reason: 'bad_token' },
    });
  });

  it('defaults details to an empty record so a caller need not pass one', () => {
    const logger = new FakeLogger();

    logger.info('started');

    expect(logger.last?.details).toEqual({});
  });

  it('selects by level', () => {
    const logger = new FakeLogger();
    logger.info('a');
    logger.error('b');
    logger.error('c');

    expect(logger.at('error').map((line) => line.event)).toEqual(['b', 'c']);
  });

  it('answers whether an event was logged at all', () => {
    const logger = new FakeLogger();
    logger.warn('request_denied');

    expect(logger.logged('request_denied')).toBe(true);
    expect(logger.logged('never_happened')).toBe(false);
  });
});

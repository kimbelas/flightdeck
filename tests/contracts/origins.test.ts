// Every statement of "where core is" takes the port since P11 (D65). The constants are the
// functions at 4950, so this machine's origins did not move.
import { describe, expect, it } from 'vitest';
import {
  CORE_HOSTS,
  CORE_ORIGIN,
  CORE_WEBSOCKET,
  coreHosts,
  coreOrigin,
  coreWebSocket,
} from '../../contracts/origins.ts';

describe('origins', () => {
  it('keeps this machine on 4950', () => {
    expect(CORE_ORIGIN).toBe('http://127.0.0.1:4950');
    expect(CORE_WEBSOCKET).toBe('ws://127.0.0.1:4950');
    expect(CORE_HOSTS).toEqual(['127.0.0.1:4950', 'localhost:4950']);
  });

  it('names an outpost core by its own loopback port, never another address', () => {
    expect(coreOrigin(4951)).toBe('http://127.0.0.1:4951');
    expect(coreWebSocket(4951)).toBe('ws://127.0.0.1:4951');
    expect(coreHosts(4951)).toEqual(['127.0.0.1:4951', 'localhost:4951']);
  });
});

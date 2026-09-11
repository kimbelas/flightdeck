// The `/pty` handshake credential — SEC-WS-1, and the whole of P5a-T2b.
//
// Split from pty-socket-server.test.ts when the first frame became a ticket: what is proven here
// is that a socket costs a process only when a credential minted by core, for this target, spent
// for the first time, arrives inside the deadline. Every other first frame closes 1008 and spawns
// nothing — including the per-boot token, which is the shortcut D31 took and D32 closed.
//
// A real `ws` client against a real server, because the refusals happen in the handshake, before
// any object a unit test could hold exists. The harness is shared — see pty-socket-harness.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeCode,
  collect,
  PtySocketHarness,
  SESSION,
  SESSION_QUERY,
  SHELL,
  SHELL_QUERY,
  TICKET_TTL_MS,
  TOKEN,
} from './pty-socket-harness.ts';

let harness: PtySocketHarness;

beforeEach(async () => {
  harness = await PtySocketHarness.start();
});

afterEach(async () => {
  await harness.stop();
});

describe('nothing at all', () => {
  it('closes 1008 when no first frame ever arrives', async () => {
    const socket = harness.open(SHELL_QUERY);

    expect(await closeCode(socket)).toBe(1008);
  });

  it('spawns nothing while it waits — an unauthenticated socket must never cost a process', async () => {
    const socket = harness.open(SHELL_QUERY);

    await closeCode(socket);

    expect(harness.host.spawned).toHaveLength(0);
  });
});

describe('a first frame that is not a valid ticket', () => {
  it('closes 1008 on a ticket core never issued', async () => {
    const socket = harness.sending({ type: 'auth', ticket: 'g'.repeat(64) });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 on the per-boot TOKEN, which is not a ticket and is no longer in the page', async () => {
    // The regression test for P5a-T2b: before it, this exact frame opened a PTY (D31).
    const socket = harness.sending({ type: 'auth', ticket: TOKEN });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 on the old token-shaped frame, which no longer parses at all', async () => {
    const socket = harness.sending({ type: 'auth', token: TOKEN });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 when the first frame is input rather than auth', async () => {
    const socket = harness.sending({ type: 'input', data: 'whoami\r' });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 on an empty ticket', async () => {
    const socket = harness.sending({ type: 'auth', ticket: '' });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });
});

describe('a ticket that was valid once', () => {
  it('closes 1008 the second time it is spent', async () => {
    const ticket = harness.tickets.mint(SHELL);
    const first = harness.sending({ type: 'auth', ticket });
    await collect(first, 1);

    const second = harness.sending({ type: 'auth', ticket });

    expect(await closeCode(second)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(1);
    first.close();
  });

  it('closes 1008 once it has expired', async () => {
    const ticket = harness.tickets.mint(SHELL);
    harness.clock.advance(TICKET_TTL_MS + 1);

    const socket = harness.sending({ type: 'auth', ticket });

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });
});

describe('a ticket for somewhere else — the cap P5a-T2b buys', () => {
  it('closes 1008 when a shell ticket is offered on a session socket', async () => {
    const socket = harness.sending(
      { type: 'auth', ticket: harness.tickets.mint(SHELL) },
      SESSION_QUERY,
    );

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 when a session ticket is offered on a shell socket', async () => {
    const socket = harness.sending(
      { type: 'auth', ticket: harness.tickets.mint(SESSION) },
      SHELL_QUERY,
    );

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });

  it('closes 1008 when the ticket names the other subscription', async () => {
    const ticket = harness.tickets.mint({ ...SESSION, subscription: 'isg' });

    const socket = harness.sending({ type: 'auth', ticket }, SESSION_QUERY);

    expect(await closeCode(socket)).toBe(1008);
    expect(harness.host.spawned).toHaveLength(0);
  });
});

describe('the ticket a pane actually holds', () => {
  it('opens the shell it was minted for', async () => {
    const socket = harness.sending({ type: 'auth', ticket: harness.tickets.mint(SHELL) });

    const [ready] = await collect(socket, 1);

    expect(ready).toMatchObject({ type: 'ready', target: { kind: 'shell' } });
    socket.close();
  });

  it('opens exactly the session it was minted for', async () => {
    const socket = harness.sending(
      { type: 'auth', ticket: harness.tickets.mint(SESSION) },
      SESSION_QUERY,
    );

    const [ready] = await collect(socket, 1);

    expect(ready).toMatchObject({ type: 'ready', target: { kind: 'session' } });
    socket.close();
  });

  it('is spent by the socket, leaving nothing outstanding to replay', async () => {
    const socket = harness.sending({ type: 'auth', ticket: harness.tickets.mint(SHELL) });
    await collect(socket, 1);

    expect(harness.tickets.outstandingCount).toBe(0);
    socket.close();
  });
});

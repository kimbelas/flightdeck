// `WS /pty` end to end over a real socket — SEC-WS-1's upgrade, SEC-WS-2, SEC-WS-3.
//
// A real `ws` client against a real `node:http` server, because the handshake is the control and
// a handshake cannot be unit-tested: the refusals happen in the upgrade, before any object this
// test could hold exists. The PTY underneath is fake — what is being proven here is the socket.
//
// The first frame has a suite of its own (pty-socket-auth.test.ts): it carries a single-use ticket
// now, and the ways that can fail outgrew this file (P5a-T2b).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeCode,
  collect,
  PtySocketHarness,
  SESSION,
  SESSION_QUERY,
  SHELL_QUERY,
} from './pty-socket-harness.ts';

let harness: PtySocketHarness;

beforeEach(async () => {
  harness = await PtySocketHarness.start();
});

afterEach(async () => {
  await harness.stop();
});

describe('the upgrade (SEC-WS-1)', () => {
  it('refuses a hostile origin', async () => {
    const socket = harness.open(SHELL_QUERY, 'http://evil.com');

    await closeCode(socket);

    expect(harness.host.spawned).toHaveLength(0);
  });

  it('refuses an upgrade with no Origin at all, even though HTTP allows one', async () => {
    const socket = harness.open(SHELL_QUERY, null);

    await closeCode(socket);

    expect(harness.host.spawned).toHaveLength(0);
  });

  it('refuses a path that is not /pty', async () => {
    const socket = harness.open('/not-pty?shell=1');

    await closeCode(socket);

    expect(harness.host.spawned).toHaveLength(0);
  });

  it('refuses an unparseable bind target', async () => {
    const socket = harness.open('/pty?session=!!!&subscription=365');

    await closeCode(socket);

    expect(harness.host.spawned).toHaveLength(0);
  });
});

describe('an authorised socket', () => {
  it('answers ready with the pid and spawns exactly one PTY', async () => {
    const socket = harness.authorised();

    const [ready] = await collect(socket, 1);

    expect(ready).toMatchObject({ type: 'ready', target: { kind: 'shell' } });
    expect(harness.host.spawned).toHaveLength(1);
    socket.close();
  });

  it('carries PTY output back as output frames', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);
    const frames = collect(socket, 1);

    harness.host.last?.emit('hello from the pty');

    expect(await frames).toContainEqual({ type: 'output', data: 'hello from the pty' });
    socket.close();
  });

  it('writes an input frame into the PTY', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);

    socket.send(JSON.stringify({ type: 'input', data: 'dir\r' }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.host.last?.written).toContain('dir\r');
    socket.close();
  });

  it('applies a resize frame', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);

    socket.send(JSON.stringify({ type: 'resize', cols: 132, rows: 43 }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.host.last?.resizes).toContainEqual({ cols: 132, rows: 43 });
    socket.close();
  });

  it('drops a malformed frame instead of answering it', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);

    socket.send('not json at all');
    socket.send(JSON.stringify({ type: 'resize', cols: -1, rows: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.host.last?.resizes).toHaveLength(0);
    expect(harness.host.last?.killed).toBe(false);
    socket.close();
  });

  it('cannot be retargeted by a later frame (SEC-WS-2)', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);

    // There is no frame that names a target; the closest a client can do is send another auth,
    // carrying a fresh ticket for somewhere else. It is not even read — the bind already happened.
    socket.send(JSON.stringify({ type: 'auth', ticket: harness.tickets.mint(SESSION) }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.host.spawned).toHaveLength(1);
    socket.close();
  });

  it('reports an exit and closes when the PTY ends', async () => {
    const socket = harness.authorised();
    await collect(socket, 1);
    const frames = collect(socket, 1);

    harness.host.last?.finish(3);

    expect(await frames).toContainEqual({ type: 'exit', code: 3 });
  });

  it('refuses a second socket on a held session, without spawning (SEC-WS-3)', async () => {
    const first = harness.authorised(SESSION_QUERY);
    await collect(first, 1);

    const second = harness.authorised(SESSION_QUERY);
    const frames = await collect(second, 1);

    expect(frames).toContainEqual({ type: 'error', reason: 'held_elsewhere' });
    expect(harness.host.spawned).toHaveLength(1);
    first.close();
  });

  it('releases the session when the socket closes, so it can be re-attached', async () => {
    const first = harness.authorised(SESSION_QUERY);
    await collect(first, 1);
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = harness.authorised(SESSION_QUERY);
    const [ready] = await collect(second, 1);

    expect(ready).toMatchObject({ type: 'ready' });
    second.close();
  });
});

// P0-T7 — the half of the probe that must NOT be a browser.
//
// Forging a header is cheating when you are testing Origin, and faithful when you are testing
// Host: a DNS-rebinding attack produces a Host the browser copied from a hostname it resolved to
// 127.0.0.1, so sending that Host directly is the same request the victim's browser would send.
// True end-to-end rebinding needs a DNS name that re-resolves, which is not available offline —
// that row is reported as simulated, never as proven (RESEARCH.md F.4).
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocket } from 'ws';

export interface Attempt {
  readonly name: string;
  /** HTTP status, WebSocket close code, or 0 when the connection never produced one. */
  readonly status: number;
  readonly detail: string;
}

export interface PostSpec {
  readonly host?: string;
  readonly contentType?: string;
  readonly token?: string;
  readonly origin?: string;
  readonly fetchSite?: string;
  readonly bodyBytes?: number;
}

export interface SocketSpec {
  readonly origin?: string;
  readonly token?: string;
  /** Omit to say nothing at all, which is what the 2 s first-frame timer is for. */
  readonly sendFirstFrame?: boolean;
}

/** A plain client that will send anything it is told to, including things a browser never would. */
export class NodeProbe {
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  /** The first non-loopback IPv4 address, or undefined on a machine with none. */
  public static lanAddress(): string | undefined {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) return address.address;
      }
    }
    return undefined;
  }

  public post(name: string, spec: PostSpec): Promise<Attempt> {
    const body = Buffer.alloc(spec.bodyBytes ?? 14, 0x61);
    return new Promise((resolve) => {
      const outgoing = httpRequest(
        {
          host: '127.0.0.1',
          port: this.port,
          method: 'POST',
          path: '/probe',
          headers: this.headers(spec, body.byteLength),
        },
        (response) => {
          response.resume();
          resolve({ name, status: response.statusCode ?? 0, detail: 'answered' });
        },
      );
      outgoing.on('error', (error) => {
        resolve({ name, status: 0, detail: error.message });
      });
      outgoing.end(body);
    });
  }

  public socket(name: string, spec: SocketSpec): Promise<Attempt> {
    return new Promise((resolve) => {
      const client = new WebSocket(`ws://127.0.0.1:${String(this.port)}/pty`, {
        headers: spec.origin === undefined ? {} : { origin: spec.origin },
      });
      const settle = (status: number, detail: string): void => {
        resolve({ name, status, detail });
        client.removeAllListeners();
        client.close();
      };
      // Longer than the server's 2 s first-frame timer, so "said nothing" resolves as a close.
      const timer = setTimeout(() => {
        settle(0, 'no answer in 4 s');
      }, 4_000);
      client.on('open', () => {
        if (spec.sendFirstFrame === true) client.send(spec.token ?? '');
      });
      client.on('message', (data: Buffer) => {
        clearTimeout(timer);
        settle(1000, `server replied ${data.toString('utf8')}`);
      });
      client.on('close', (code) => {
        clearTimeout(timer);
        settle(code, 'closed');
      });
      client.on('error', (error) => {
        clearTimeout(timer);
        settle(0, error.message);
      });
    });
  }

  /** SEC-NET-1: anything but 127.0.0.1 must not answer, because nothing is bound there. */
  public reachable(name: string, host: string, timeoutMs: number): Promise<Attempt> {
    return new Promise((resolve) => {
      const socket = connect({ host, port: this.port });
      const settle = (status: number, detail: string): void => {
        resolve({ name, status, detail });
        socket.destroy();
      };
      socket.setTimeout(timeoutMs, () => {
        settle(0, `no answer in ${String(timeoutMs)} ms (dropped)`);
      });
      socket.on('connect', () => {
        settle(200, 'CONNECTED — something is listening');
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        settle(0, error.code ?? error.message);
      });
    });
  }

  private headers(spec: PostSpec, length: number): Record<string, string> {
    const headers: Record<string, string> = {
      host: spec.host ?? `127.0.0.1:${String(this.port)}`,
      'content-type': spec.contentType ?? 'application/json',
      'content-length': String(length),
    };
    if (spec.token !== undefined) headers['authorization'] = `Bearer ${spec.token}`;
    if (spec.origin !== undefined) headers['origin'] = spec.origin;
    if (spec.fetchSite !== undefined) headers['sec-fetch-site'] = spec.fetchSite;
    return headers;
  }
}

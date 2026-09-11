// P0-T7 — a browser origin, served on its own loopback port.
//
// Two of these run: the deck's origin (:4949) and a hostile page's (:5999). To a browser those
// are different origins, which is all a cross-origin test needs — no external host, no DNS,
// nothing leaves the machine (SEC-NET-2).
//
// It also serves the **same-origin rewrite**: `/api/*` is forwarded to core from the Node side,
// with the token attached. That is the only route by which the real deck is supposed to reach
// core (SEC-HTTP-5), and running it here is what makes the probe able to show a legitimate
// request succeeding rather than only hostile ones failing.
import { request as httpRequest } from 'node:http';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface RewriteTarget {
  readonly port: number;
  readonly token: string;
}

export interface PageOriginOptions {
  readonly port: number;
  readonly page: string;
  /** Omit for a plain static origin, i.e. a page with no server of its own to help it. */
  readonly rewriteTo?: RewriteTarget;
}

/** One page on one loopback port, optionally with a server-side rewrite to core. */
export class PageOrigin {
  private readonly options: PageOriginOptions;
  private readonly server: Server;

  constructor(options: PageOriginOptions) {
    this.options = options;
    this.server = createServer((incoming, response) => {
      this.route(incoming, response);
    });
  }

  public get origin(): string {
    return `http://127.0.0.1:${String(this.options.port)}`;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }

  private route(incoming: IncomingMessage, response: ServerResponse): void {
    const rewrite = this.options.rewriteTo;
    if (rewrite !== undefined && (incoming.url ?? '').startsWith('/api/')) {
      this.forward(incoming, response, rewrite);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(this.options.page);
  }

  /**
   * Server-to-server, so the browser never sees core's origin and no CORS is involved. The
   * token is attached here and never reaches the page — the page has no way to obtain it, which
   * is the point of keeping it in a file with an ACL (SEC-HTTP-3, SEC-FS-4).
   */
  private forward(incoming: IncomingMessage, response: ServerResponse, to: RewriteTarget): void {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const body = Buffer.concat(chunks);
      const proxied = httpRequest(
        {
          host: '127.0.0.1',
          port: to.port,
          method: incoming.method ?? 'POST',
          path: (incoming.url ?? '/').replace(/^\/api/, ''),
          headers: {
            host: `127.0.0.1:${String(to.port)}`,
            'content-type': 'application/json',
            'content-length': String(body.byteLength),
            authorization: `Bearer ${to.token}`,
          },
        },
        (upstream) => {
          response.writeHead(upstream.statusCode ?? 502, { 'content-type': 'application/json' });
          upstream.pipe(response);
        },
      );
      proxied.on('error', () => {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end('{"error":"rewrite failed"}');
      });
      proxied.end(body);
    });
  }
}

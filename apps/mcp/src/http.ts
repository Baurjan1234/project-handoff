/**
 * The socket. Everything above it is a pure function of a request.
 *
 * `handle` decides; this file only reads bytes off a socket and writes them
 * back. That split is why the gate can be tested without binding a port, and
 * why the tests can assert what was and was not called on the facilitator.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handle, type HttpRequest, type ServerDeps } from "./server.js";

/**
 * An order carries a base64 artifact, so the body is not small. It is also not
 * unbounded: without a cap, a single request can hold the process's memory.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super(`request body over ${MAX_BODY_BYTES} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, headers: Readonly<Record<string, string>>, body: unknown): void {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

export interface HttpServerOptions {
  /** One line per request. The demo reads it off the screen, so keep it short. */
  readonly log?: (line: string) => void;
}

export function createHttpServer(deps: ServerDeps, options: HttpServerOptions = {}): Server {
  const log = options.log ?? (() => {});

  return createServer((incoming, response) => {
    void (async () => {
      try {
        const request: HttpRequest = {
          method: incoming.method ?? "GET",
          path: new URL(incoming.url ?? "/", "http://localhost").pathname,
          headers: incoming.headers as Readonly<Record<string, string | undefined>>,
          body: await readBody(incoming),
        };

        const result = await handle(request, deps);
        log(`${request.method} ${request.path} -> ${result.status}`);
        send(response, result.status, result.headers, result.body);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          send(response, 413, { "Content-Type": "application/json" }, { error: error.message });
          return;
        }

        // Nothing above should reach here: handle() answers a facilitator
        // outage with 503 and a failed post with 502. A socket left open
        // because of an unforeseen throw is worse than an ugly 500.
        send(
          response,
          500,
          { "Content-Type": "application/json" },
          { error: "unhandled", detail: (error as Error).message },
        );
      }
    })();
  });
}

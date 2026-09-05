/**
 * The MCP server process, spoken over stdio.
 *
 * Started by an agent client (Claude Code, Cursor, a desktop app), not by us,
 * so it takes everything from the environment and writes nothing to stdout.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./server.js";
import { UnwiredSigner } from "./client.js";

const baseUrl = process.env["HANDOFF_SERVICE_URL"]?.trim() ?? "http://localhost:4021";

// stderr, because stdout is the JSON-RPC channel.
console.error(`handoff_verify -> ${baseUrl}`);
console.error(
  "payment signer: none. Ordering will report the price and stop until the x402 client lands.",
);

serveStdio(() => createMcpServer({ baseUrl, signer: new UnwiredSigner() }));

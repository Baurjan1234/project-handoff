/**
 * The MCP server process, spoken over stdio.
 *
 * Started by an agent client (Claude Code, Cursor, a desktop app), not by us,
 * so it takes everything from the environment and writes nothing to stdout.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./server.js";
import { fetchTags, UnwiredSigner } from "./client.js";

const baseUrl = process.env["HANDOFF_SERVICE_URL"]?.trim() ?? "http://localhost:4021";

// stderr, because stdout is the JSON-RPC channel.
console.error(`handoff_verify -> ${baseUrl}`);
console.error(
  "payment signer: none. Ordering will report the price and stop until the x402 client lands.",
);

// The tag list has to be in hand before the tool schema exists, because the
// schema enumerates it — that enumeration is what makes a wrong tag impossible
// rather than merely discouraged. Failing to start is the right failure: a
// server that cannot say what it routes to cannot take an order either.
const certTags = await fetchTags({ baseUrl });
console.error(`credentials: ${certTags.map((tag) => tag.code).join(", ")}`);

serveStdio(() => createMcpServer({ baseUrl, signer: new UnwiredSigner(), certTags }));

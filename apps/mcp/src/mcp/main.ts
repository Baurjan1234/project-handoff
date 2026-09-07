/**
 * The MCP server process, spoken over stdio.
 *
 * Started by an agent client (Claude Code, Cursor, a desktop app), not by us,
 * so it takes everything from the environment and writes nothing to stdout.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./server.js";
import { fetchTags, UnwiredSigner } from "./client.js";
import type { CertTagOption } from "../config.js";

const baseUrl = process.env["HANDOFF_SERVICE_URL"]?.trim() ?? "http://localhost:4021";

// stderr, because stdout is the JSON-RPC channel.
console.error(`handoff_verify -> ${baseUrl}`);
console.error(
  "payment signer: none. Ordering will report the price and stop until the x402 client lands.",
);

/**
 * Fetch the tag list, patiently, and start anyway if it never arrives.
 *
 * An agent client starts this process on its own schedule, and nothing
 * guarantees the resource server came up first. Exiting on a connection
 * refused would leave the session with no `handoff` tools at all — and nobody
 * restarts an agent client to recover a tool they never saw appear, so the
 * failure would read as "the MCP server is broken" rather than as "start the
 * other process."
 *
 * So: retry over a few seconds, and if it still will not answer, start with an
 * unenumerated tag. The tool description says the list is unknown, and the
 * resource server still refuses an unknown tag on the wire with the exact
 * copy. The weaker guarantee is the schema one, and it fails safe.
 */
async function resolveTags(): Promise<readonly CertTagOption[]> {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchTags({ baseUrl });
    } catch (error) {
      if (attempt === attempts) {
        console.error(
          `could not read the credential list from ${baseUrl} after ${attempts} tries ` +
            `(${(error as Error).message}). Start the resource server, then restart this ` +
            `session to get the tags enumerated. Ordering still works and an unknown tag ` +
            `is still refused, just by the server rather than by the tool schema.`,
        );
        return [];
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return [];
}

const certTags = await resolveTags();
if (certTags.length > 0) {
  console.error(`credentials: ${certTags.map((tag) => tag.code).join(", ")}`);
}

serveStdio(() => createMcpServer({ baseUrl, signer: new UnwiredSigner(), certTags }));

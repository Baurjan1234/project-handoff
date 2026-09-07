import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { looksLikeSecretName, secretNameMessage } from "./src/chain/secretNames";
import { describePrivateKey } from "./src/session/keyShape";

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Hard rule 2 at build time. Everything `VITE_` in .env is inlined into the
 * bundle, and the app's own runtime check only runs after that bundle has
 * been served. So `vite build` and `vite dev` refuse first, on a name that
 * says secret or a value shaped like a private key. The value is never
 * printed.
 */
function refuseSecretsInEnv(mode: string): void {
  const env = loadEnv(mode, here("."), "VITE_");
  for (const [name, value] of Object.entries(env)) {
    if (looksLikeSecretName(name)) throw new Error(secretNameMessage(name));
    if (describePrivateKey(value).ok) {
      throw new Error(`${name} holds what looks like a private key. Anything prefixed VITE_ is bundled into the browser build. Remove it.`);
    }
  }
}

export default defineConfig(({ mode }) => {
  refuseSecretsInEnv(mode);
  return config;
});

const config = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": here("./src"),
      // `@handoff/schema` hashes with node:crypto, which the browser does not
      // have. The app hashes through src/sign/notes.ts over Web Crypto, and
      // this shim makes any other call fail loudly instead of bundling a Node
      // built-in. It stays on under test as well, so a stray call from app
      // code fails in CI rather than only in a browser; notes.test.ts takes
      // its reference digest from Node's own "crypto" module instead.
      "node:crypto": here("./src/shims/node-crypto.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
};

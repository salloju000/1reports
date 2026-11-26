import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  const certificate = process.env.HUB_DEV_HTTPS_CERT;
  const key = process.env.HUB_DEV_HTTPS_KEY;
  const base = process.env.HUB_BASE_PATH ?? (command === "build" ? "/1Reports/" : "/");
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
    throw new Error("HUB_BASE_PATH must be / or a path such as /1Reports/.");
  }
  const apiPrefix = base + "api";

  if (command === "serve" && Boolean(certificate) !== Boolean(key)) {
    throw new Error("Set both HUB_DEV_HTTPS_CERT and HUB_DEV_HTTPS_KEY.");
  }

  return {
    plugins: [react(), tailwindcss()],
    base,
    envPrefix: [],
    test: { setupFiles: ["src/test/setup.ts"], testTimeout: 30_000 },
    server: {
      proxy: process.env.HUB_DEV_API_URL ? {
        [`^${apiPrefix}(?:/|\\?|$)`]: {
          target: process.env.HUB_DEV_API_URL,
          rewrite: (path) => path.slice(base.length - 1),
          headers: { "X-Forwarded-Proto": certificate && key ? "https" : "http" },
        },
      } : undefined,
      // The .NET API's build output churns locked temp files that crash the watcher.
      watch: { ignored: ["**/server/bin/**", "**/server/obj/**"] },
      ...(command === "serve" && certificate && key
        ? { https: { cert: readFileSync(certificate), key: readFileSync(key) } }
        : {}),
    },
  };
});

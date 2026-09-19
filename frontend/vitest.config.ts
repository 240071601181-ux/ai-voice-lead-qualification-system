import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["client/src/test-setup.ts"],
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      // Phase 9: node-safe client tests (API services + pure view helpers,
      // network boundary mocked). Phase 12: DOM interaction tests opt into
      // jsdom per-file via `// @vitest-environment jsdom`.
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
    ],
  },
});

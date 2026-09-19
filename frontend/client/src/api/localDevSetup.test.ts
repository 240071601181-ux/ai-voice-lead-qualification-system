/**
 * Permanent local-development setup (frontend side).
 *
 * Locks in the fixed day-to-day contract without touching the network:
 * - Frontend dev server is pinned to port 3000 with strictPort (fails fast
 *   instead of silently switching ports).
 * - The Manus full-stack dev entry fails with a clear message when 3000 is
 *   occupied (no silent port switching).
 * - VITE_API_BASE_URL points at the fixed backend http://localhost:4000.
 * - No server secrets live in frontend env files.
 *
 * Node-safe: pure fs/string assertions, no DOM/renderer needed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");

describe("local development setup (frontend contract)", () => {
  it("pins the Vite dev server to port 3000 with strictPort", () => {
    const config = read("vite.config.ts");
    expect(config).toMatch(/port:\s*3000/);
    expect(config).toMatch(/strictPort:\s*true/);
  });

  it("fails fast (no silent port switch) when 3000 is occupied", () => {
    const entry = read("server/_core/index.ts");
    expect(entry).not.toMatch(/is busy, using port/);
    expect(entry).not.toMatch(/findAvailablePort/);
    expect(entry).toMatch(/already in use/);
  });

  it("runs the dev script deterministically on PORT=3000", () => {
    const pkg = JSON.parse(read("package.json") as string) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dev).toContain("PORT=3000");
    expect(pkg.scripts["dev:spa"]).toMatch(/--port 3000/);
    expect(pkg.scripts["dev:spa"]).toMatch(/--strictPort/);
  });

  it("points VITE_API_BASE_URL at the fixed backend in .env.example", () => {
    const example = read(".env.example");
    expect(example).toMatch(/^VITE_API_BASE_URL=http:\/\/localhost:4000$/m);
  });

  it("keeps server secrets out of frontend env files", () => {
    const example = read(".env.example");
    expect(example).not.toMatch(/AUTH_JWT_SECRET/);
    expect(example).not.toMatch(/JWT_SECRET\s*=/);
    expect(example).not.toMatch(/DATABASE_URL/);
    if (fs.existsSync(path.join(FRONTEND_ROOT, ".env"))) {
      const local = read(".env");
      expect(local).not.toMatch(/AUTH_JWT_SECRET/);
      expect(local).not.toMatch(/DATABASE_URL/);
    }
  });

  it("documents OAUTH_SERVER_URL as not required for local development", () => {
    const example = read(".env.example");
    expect(example).toMatch(/OAUTH_SERVER_URL.*NOT required for/);
    const sdk = read("server/_core/sdk.ts");
    expect(sdk).not.toMatch(/OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL/);
  });
});

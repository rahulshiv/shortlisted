/**
 * Builds the hosted deployment in Vercel's Build Output API v3 format (.vercel/output):
 * the verifier page as static files, and the API + MCP endpoint as one Node function.
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { REPO_ROOT } from "@shortlisted/store";

const out = resolve(REPO_ROOT, ".vercel/output");
const fn = resolve(out, "functions/index.func");
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

execSync("pnpm --filter @shortlisted/verify-web build", { cwd: REPO_ROOT, stdio: "inherit" });
cpSync(resolve(REPO_ROOT, "apps/verify-web/dist"), resolve(out, "static"), { recursive: true });

// Resolved from the store package, which is what depends on libsql (pnpm keeps it out of the root).
const libsqlWeb = createRequire(resolve(REPO_ROOT, "packages/store/package.json")).resolve("@libsql/client/web");

await build({
  entryPoints: [resolve(REPO_ROOT, "apps/api/src/vercel.ts")],
  outfile: resolve(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The default libsql client loads a native SQLite binding for file: URLs. Hosted, the
  // database is always remote (Turso), so use the pure-fetch client instead.
  alias: { "@libsql/client": libsqlWeb },
  // Some bundled CommonJS deps call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "info",
});

writeFileSync(
  resolve(fn, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2),
);
writeFileSync(
  resolve(out, "config.json"),
  // "/" isn't mapped to index.html by the filesystem phase, so route it explicitly.
  JSON.stringify({ version: 3, routes: [{ src: "^/$", dest: "/index.html" }, { handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }, null, 2),
);
console.log(`built ${out}`);

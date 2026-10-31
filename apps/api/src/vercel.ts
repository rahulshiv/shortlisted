import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createContext, createMcpHttpApp } from "@shortlisted/mcp-server";
import { createApi } from "./app.ts";

/**
 * One serverless function for the hosted deployment: the HTTP API and the Streamable HTTP MCP
 * endpoint on the same origin. The verifier page is served as static files next to it.
 * Bundled by scripts/build-vercel.ts.
 */
async function createApp() {
  for (const name of ["SHORTLISTED_ED25519_PRIVATE_KEY", "SHORTLISTED_DB_URL"]) {
    if (!process.env[name]) throw new Error(`${name} must be set (the filesystem is read-only here)`);
  }
  const ctx = await createContext();
  const app = new Hono();
  app.route("/", createApi(ctx));
  app.route("/", createMcpHttpApp(ctx));
  return app;
}

let listener: Promise<ReturnType<typeof getRequestListener>> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  listener ??= createApp().then((app) => getRequestListener(app.fetch));
  try {
    return (await listener)(req, res);
  } catch (err) {
    listener = undefined; // retry setup on the next request
    throw err;
  }
}

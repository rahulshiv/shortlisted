import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";
import { createContext, type Context } from "./context.ts";
import { createMcpServer } from "./tools.ts";

/** Stateless Streamable HTTP MCP endpoint. Web-standard Request/Response, so it can move to Workers. */
export function createMcpHttpApp(ctx: Context, token = process.env.SHORTLISTED_MCP_TOKEN) {
  const app = new Hono();
  app.get("/", (c) => c.json({ name: "shortlisted-mcp", transport: "streamable-http", endpoint: "/mcp" }));
  app.all("/mcp", async (c) => {
    if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(ctx);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ctx = await createContext();
  const port = Number(process.env.MCP_PORT ?? 8788);
  serve({ fetch: createMcpHttpApp(ctx).fetch, port });
  console.log(`shortlisted MCP (Streamable HTTP) on http://localhost:${port}/mcp`);
}

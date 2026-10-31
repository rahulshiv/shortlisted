import { serve } from "@hono/node-server";
import { createContext } from "@shortlisted/mcp-server";
import { createApi } from "./app.ts";

const ctx = await createContext();
const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: createApi(ctx).fetch, port });
console.log(`shortlisted API on http://localhost:${port}  (issuer key ${ctx.key.publicKey})`);

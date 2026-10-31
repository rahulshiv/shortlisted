import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context.ts";
import { createMcpServer } from "./tools.ts";

// stdout carries the MCP protocol, so all logging goes to stderr.
const ctx = await createContext();
const server = createMcpServer(ctx);
await server.connect(new StdioServerTransport());
console.error(`shortlisted MCP (stdio) ready. issuer key ${ctx.key.publicKey}`);

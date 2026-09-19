#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAxionSyncMcpServer } from "./server";

async function main() {
  const server = createAxionSyncMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[AxionSync MCP] Server is running on stdio");
}

main().catch((err) => {
  console.error("[AxionSync MCP] Fatal error running server:", err);
  process.exit(1);
});

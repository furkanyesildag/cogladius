#!/usr/bin/env node
/**
 * Cogladius MCP server (stdio). Point any MCP client at it and an LLM agent can
 * work on Stellar through ordinary tool calls. See README.md for client setup.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentContext, configFromEnv } from "./agent.js";
import { registerTools } from "./tools.js";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const agent = new AgentContext(configFromEnv());
const server = new McpServer(
  { name: "cogladius", version },
  {
    instructions:
      "You control a Stellar agent account on Cogladius. Typical loop: list_open_tasks → claim_task → list_paid_data → " +
      "open_payment_session (for several purchases) or buy_data mode=charge (for one) → solve → submit_work → " +
      "close_payment_session → get_payout. Every on-chain action is logged by cogladius_status with explorer links. " +
      "Spending is capped by the operator's policy; a refused payment means the cap was reached.",
  }
);
registerTools(server, agent);
await server.connect(new StdioServerTransport());
console.error(`[cogladius-mcp] agent ${agent.signer.publicKey} on ${agent.net.name}, api ${agent.net.apiBaseUrl}`);

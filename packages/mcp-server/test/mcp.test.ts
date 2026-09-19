import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentContext } from "../src/agent.js";
import { registerTools } from "../src/tools.js";

async function connect(fetchImpl?: typeof fetch) {
  const agent = new AgentContext(
    { secret: Keypair.random().secret(), network: "mainnet", apiBaseUrl: "https://api.invalid", maxSpend: "1", maxPerPayment: "0.1", maxSessionDeposit: "0.5", stateDir: "/tmp/cog-mcp-test" },
    fetchImpl
  );
  const server = new McpServer({ name: "cogladius", version: "test" });
  registerTools(server, agent);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, agent };
}

describe("MCP tool surface", () => {
  it("exposes the economic loop and nothing else", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["buy_data", "claim_task", "close_payment_session", "cogladius_status", "get_payout", "get_reputation", "list_open_tasks", "list_paid_data", "open_payment_session", "submit_work"].sort()
    );
  });

  it("reports status with the spend policy", async () => {
    const { client, agent } = await connect();
    const r: any = await client.callTool({ name: "cogladius_status", arguments: {} });
    const s = JSON.parse(r.content[0].text);
    expect(s.address).toBe(agent.signer.publicKey);
    expect(s.policy).toMatchObject({ maxSpendXlm: "1", spentXlm: "0" });
  });

  it("refuses a session deposit above the policy before touching the chain", async () => {
    const fetchImpl = (async (url: string) =>
      new Response(JSON.stringify({ success: true, recipient: Keypair.random().publicKey(), session: { channelFactory: "CFACTORY", minRefundWaitingPeriodLedgers: 17280 } }))) as any;
    const { client } = await connect(fetchImpl);
    const orig = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const r: any = await client.callTool({ name: "open_payment_session", arguments: { depositXlm: "0.6" } });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/session deposit/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("surfaces tool errors as MCP errors instead of crashing", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "buy_data", arguments: { resource: "network-metrics", mode: "session" } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no open payment session/);
  });
});

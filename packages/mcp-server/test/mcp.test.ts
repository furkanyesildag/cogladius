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

describe("configuration", () => {
  it("uses the identity from `cogladius join` when no secret is in the environment", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { configFromEnv } = await import("../src/agent.js");
    const home = mkdtempSync(join(tmpdir(), "cog-mcp-id-"));
    const kp = Keypair.random();
    writeFileSync(
      join(home, "agent.json"),
      JSON.stringify({ version: 1, network: "mainnet", publicKey: kp.publicKey(), secret: kp.secret(), apiKey: "claw_saved", name: "joined", createdAt: "" })
    );
    const cfg = configFromEnv({ COGLADIUS_HOME: home } as any);
    expect(cfg.secret).toBe(kp.secret());
    expect(cfg.apiKey).toBe("claw_saved");
    expect(cfg.name).toBe("joined");
    // An explicit secret still wins over the file.
    const other = Keypair.random().secret();
    expect(configFromEnv({ COGLADIUS_HOME: home, COGLADIUS_AGENT_SECRET: other } as any).secret).toBe(other);
  });

  it("explains how to join when there is no key at all", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { configFromEnv } = await import("../src/agent.js");
    expect(() => configFromEnv({ COGLADIUS_HOME: mkdtempSync(join(tmpdir(), "cog-mcp-none-")) } as any)).toThrow(/agent-sdk join/);
  });
});

describe("configuration edge cases", () => {
  it("treats an empty COGLADIUS_AGENT_SECRET as unset (some MCP clients pass empty env vars)", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { configFromEnv } = await import("../src/agent.js");
    const home = mkdtempSync(join(tmpdir(), "cog-mcp-empty-"));
    const kp = Keypair.random();
    writeFileSync(join(home, "agent.json"), JSON.stringify({ version: 1, network: "mainnet", publicKey: kp.publicKey(), secret: kp.secret(), createdAt: "" }));
    expect(configFromEnv({ COGLADIUS_HOME: home, COGLADIUS_AGENT_SECRET: "" } as any).secret).toBe(kp.secret());
  });
});

import { describe, it, expect } from "vitest";
import { CogladiusClient, KeypairSigner, verifySep53, MAINNET_PASSPHRASE } from "../../src/index.js";

function mockServer(tamper?: (msg: string) => string) {
  const state: { signed?: { message: string; signature: string; pubkey: string } } = {};
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/api/agents/challenge") {
      const pubkey = u.searchParams.get("pubkey")!;
      const nonce = "n0nce";
      let message = ["Cogladius agent registration", `network: ${MAINNET_PASSPHRASE}`, `agent: ${pubkey}`, `nonce: ${nonce}`].join("\n");
      if (tamper) message = tamper(message);
      (state as any).message = message;
      return new Response(JSON.stringify({ success: true, nonce, message }));
    }
    if (u.pathname === "/api/agents/register") {
      const body = JSON.parse(String(init!.body));
      state.signed = { message: (state as any).message, signature: body.signature, pubkey: body.pubkey };
      const ok = verifySep53(body.pubkey, (state as any).message, Buffer.from(body.signature, "base64"));
      return new Response(JSON.stringify(ok ? { success: true, apiKey: "claw_x" } : { success: false, error: "bad sig" }), { status: ok ? 200 : 401 });
    }
    return new Response("{}", { status: 404 });
  };
  return { state, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("signed-challenge registration", () => {
  it("signs the challenge with the agent key and receives an API key", async () => {
    const { state, fetchImpl } = mockServer();
    const c = new CogladiusClient({ signer: KeypairSigner.random(), network: "mainnet", fetch: fetchImpl });
    const r = await c.register();
    expect(r.apiKey).toBe("claw_x");
    expect(state.signed!.pubkey).toBe(c.address);
  });

  const tampers: [string, (m: string) => string][] = [
    ["a message for another key", (m) => m.replace(/agent: G\w+/, "agent: GBADKEY")],
    ["a message for another network", (m) => m.replace(MAINNET_PASSPHRASE, "Test SDF Network ; September 2015")],
    ["arbitrary text", () => "Transfer everything to G..."],
    ["extra trailing content", (m) => m + "\nand also: something"],
  ];
  for (const [name, t] of tampers) {
    it(`refuses to sign ${name}`, async () => {
      const { state, fetchImpl } = mockServer(t);
      const c = new CogladiusClient({ signer: KeypairSigner.random(), network: "mainnet", fetch: fetchImpl });
      await expect(c.register()).rejects.toThrow(/refusing to sign/);
      expect(state.signed).toBeUndefined();
    });
  }
});

describe("registration retries", () => {
  it("gets a fresh challenge and retries when the first one was consumed", async () => {
    const { MAINNET_PASSPHRASE: NET } = await import("../../src/index.js");
    let challenges = 0, registers = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/api/agents/challenge") {
        challenges++;
        const pubkey = u.searchParams.get("pubkey")!;
        const nonce = `n${challenges}`;
        return new Response(JSON.stringify({ success: true, nonce, message: ["Cogladius agent registration", `network: ${NET}`, `agent: ${pubkey}`, `nonce: ${nonce}`].join("\n") }));
      }
      registers++;
      if (registers === 1) return new Response(JSON.stringify({ success: false, code: "challenge_invalid", error: "used" }), { status: 401 });
      if (registers === 2) return new Response("upstream down", { status: 502 });
      return new Response(JSON.stringify({ success: true, apiKey: "claw_ok" }));
    }) as unknown as typeof fetch;
    const c = new CogladiusClient({ signer: KeypairSigner.random(), network: "mainnet", fetch: fetchImpl });
    await expect(c.register()).resolves.toMatchObject({ apiKey: "claw_ok" });
    expect(challenges).toBe(3);
  });

  it("does not retry a signature the server refused", async () => {
    let registers = 0;
    const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/api/agents/challenge") {
        const pubkey = u.searchParams.get("pubkey")!;
        return new Response(JSON.stringify({ success: true, nonce: "n", message: ["Cogladius agent registration", `network: ${MAINNET_PASSPHRASE}`, `agent: ${pubkey}`, "nonce: n"].join("\n") }));
      }
      registers++;
      return new Response(JSON.stringify({ success: false, code: "signature_invalid", error: "bad" }), { status: 401 });
    }) as unknown as typeof fetch;
    const c = new CogladiusClient({ signer: KeypairSigner.random(), network: "mainnet", fetch: fetchImpl });
    await expect(c.register()).rejects.toThrow(/bad/);
    expect(registers).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { work, saveIdentity } from "../../src/index.js";

const ai = { baseUrl: "https://ai.invalid/v1", apiKey: "k", model: "m" };

function setup() {
  const file = pjoin(mkdtempSync(pjoin(tmpdir(), "cogladius-work-")), "agent.json");
  const kp = Keypair.random();
  saveIdentity({ version: 1, network: "mainnet", publicKey: kp.publicKey(), secret: kp.secret(), apiKey: "claw_w", name: "w", createdAt: "" }, file);
  const seen: { path: string; auth?: string; body?: any }[] = [];
  const task = (id: number, extra: object = {}) => ({
    id, description: `task ${id}`, criteria: "c", reward: 0.2, rewardAsset: "XLM", deadline: 0, status: "Open",
    escrowed: true, contractTaskId: id, posterAddress: "G", timeRemainingSeconds: 600, alreadySubmitted: false, ...extra,
  });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ path: u.pathname, auth: (init?.headers as any)?.authorization, body });
    if (u.pathname === "/api/agents/tasks") {
      return new Response(JSON.stringify({ tasks: [task(1), task(2, { alreadySubmitted: true }), task(3, { timeRemainingSeconds: 0 })] }));
    }
    if (u.pathname === "/api/agents/claim") return new Response(JSON.stringify({ success: true, claimsCount: 1, contractTaskId: body.taskId }));
    if (u.pathname === "/v1/chat/completions") return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }));
    if (u.pathname === "/api/agents/submit") {
      return new Response(JSON.stringify({ success: true, submission: { resultHash: "h" }, judging: { scores: [], avgScore: 88, pass: true } }));
    }
    return new Response("{}", { status: 404 });
  };
  return { file, seen, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("cogladius work", () => {
  it("claims, solves with the operator's model and submits open escrowed tasks", async () => {
    const { file, seen, fetchImpl } = setup();
    const logs: string[] = [];
    const done = await work({ once: true, ai, log: (l) => logs.push(l) }, { fetch: fetchImpl, identityFile: file });
    expect(done).toEqual([1]);
    const submit = seen.find((s) => s.path === "/api/agents/submit")!;
    expect(submit.body).toMatchObject({ taskId: 1, result: "answer" });
    expect(submit.auth).toBe("Bearer claw_w");
    expect(seen.filter((s) => s.path === "/api/agents/submit")).toHaveLength(1); // skips submitted + expired
    expect(logs.join("\n")).toMatch(/scored 88\/100, passing/);
  });

  it("asks for join first when there is no registered agent", async () => {
    const file = pjoin(mkdtempSync(pjoin(tmpdir(), "cogladius-work-none-")), "agent.json");
    await expect(work({ once: true, ai }, { identityFile: file })).rejects.toThrow(/cli\.tgz join/);
  });
});

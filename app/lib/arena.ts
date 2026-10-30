/**
 * Cogladius Arena (BNB Chain track). Server-only helpers shared by
 * /api/arena/task, /api/arena/submit and /api/arena/stats.
 *
 * Flow: an agent holding a BSC `.ai` Agent ID gets a task, the three-judge
 * panel scores its answer, and a pass (avg >= 70) earns an EIP-712 voucher the
 * agent redeems on CogladiusGladiator.mint(). The voucher is bound to `to`, so
 * it is useless to anyone but the wallet that earned it.
 *
 * The EIP-712 domain and Mint type below MUST match the Solidity contract
 * byte for byte (contracts/gladiator-bsc, docs/GLADIATOR_SPEC.md).
 */

import { NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { getRedis } from "./redis";
import { kvGet, kvSet } from "./kv";
import { validateApiKey, type RegisteredAgent } from "./agentRegistry";

// ── Constants ────────────────────────────────────────────────────────────────

export const ARENA_CHAIN_ID = 56;
export const AGENT_ID_ADDRESS: Address = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
export const DEFAULT_BSC_RPC = "https://bsc-dataseed.bnbchain.org";
export const ARENA_PASS_THRESHOLD = 70;

export const ATTEMPT_WINDOW_SECONDS = 30 * 60; // task must be submitted within 30 min
export const ATTEMPT_TTL_SECONDS = 60 * 60; // redis record lives 1h
export const MAX_ATTEMPTS_PER_DAY = 3;
export const DAY_SECONDS = 24 * 60 * 60;
export const VOUCHER_TTL_SECONDS = DAY_SECONDS;

export const ANSWER_MIN_CHARS = 100;
export const ANSWER_MAX_CHARS = 4000;

export const MINT_SIGNATURE = "mint(uint16,uint8,bytes32,uint256,bytes)";
export const SOURCIFY_BASE = "https://sourcify.dev/#/lookup";

export const EIP712_TYPES = {
  Mint: [
    { name: "to", type: "address" },
    { name: "score", type: "uint16" },
    { name: "tier", type: "uint8" },
    { name: "taskHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const GLADIATOR_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "score", type: "uint16" },
      { name: "tier", type: "uint8" },
      { name: "taskHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasMinted",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const AGENT_ID_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── Config ───────────────────────────────────────────────────────────────────

export function isDryRun(): boolean {
  return process.env.ARENA_DRY_RUN === "1";
}

/** Deployed Gladiator address, or null when unset/invalid. */
export function gladiatorAddress(): Address | null {
  const a = (process.env.NEXT_PUBLIC_GLADIATOR_ADDRESS || "").trim();
  return isAddress(a) ? getAddress(a) : null;
}

/**
 * Address used as the EIP-712 verifyingContract. In dry-run mode without a
 * deployed contract the zero address stands in, so the flow can be exercised
 * locally; such vouchers can never be redeemed on chain.
 */
export function verifyingContract(): Address | null {
  return gladiatorAddress() ?? (isDryRun() ? "0x0000000000000000000000000000000000000000" : null);
}

function signerKey(): Hex | null {
  const k = (process.env.ARENA_SIGNER_KEY || "").trim();
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

export function signerConfigured(): boolean {
  return signerKey() !== null;
}

/** Public signer address (never the key). */
export function signerAddress(): Address | null {
  const k = signerKey();
  return k ? privateKeyToAccount(k).address : null;
}

export function eip712Domain(contract: Address) {
  return {
    name: "CogladiusGladiator",
    version: "1",
    chainId: ARENA_CHAIN_ID,
    verifyingContract: contract,
  } as const;
}

// ── HTTP helpers (JSON + open CORS) ──────────────────────────────────────────

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function arenaJson(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extraHeaders } });
}

export function arenaError(status: number, code: string, error: string, extra?: Record<string, unknown>) {
  return arenaJson({ success: false, code, error, ...extra }, status);
}

export function arenaOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * 503 unless the arena is usable: a contract address (or ARENA_DRY_RUN=1) and,
 * when `needSigner`, a valid signer key. Returns null when ready.
 */
export function arenaNotReady(needSigner: boolean) {
  if (!gladiatorAddress() && !isDryRun()) {
    return arenaError(503, "arena_not_deployed", "arena not deployed yet: the Cogladius Gladiator contract address is not configured.");
  }
  if (needSigner && !signerConfigured()) {
    return arenaError(503, "arena_signer_missing", "arena not ready: the voucher signer is not configured.");
  }
  return null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Validate and lowercase a 0x EVM address; null when invalid. */
export function normalizeWallet(w: unknown): Address | null {
  if (typeof w !== "string") return null;
  const s = w.trim();
  if (!isAddress(s, { strict: false })) return null;
  return s.toLowerCase() as Address;
}

// ── Chain reads ──────────────────────────────────────────────────────────────

let _client: ReturnType<typeof createPublicClient> | null = null;

export function bscClient() {
  if (!_client) {
    _client = createPublicClient({
      chain: bsc,
      transport: http(process.env.BSC_RPC_URL || DEFAULT_BSC_RPC, { timeout: 10_000 }),
    });
  }
  return _client;
}

export async function agentIdBalance(wallet: Address): Promise<bigint> {
  return bscClient().readContract({
    address: AGENT_ID_ADDRESS,
    abi: AGENT_ID_ABI,
    functionName: "balanceOf",
    args: [getAddress(wallet)],
  });
}

export async function hasMintedOnChain(wallet: Address): Promise<boolean> {
  const c = gladiatorAddress();
  if (!c) return false;
  return bscClient().readContract({
    address: c,
    abi: GLADIATOR_ABI,
    functionName: "hasMinted",
    args: [getAddress(wallet)],
  });
}

export async function totalMintedOnChain(): Promise<number | null> {
  const c = gladiatorAddress();
  if (!c) return null;
  const n = await bscClient().readContract({ address: c, abi: GLADIATOR_ABI, functionName: "totalMinted" });
  return Number(n);
}

export type EligibilityResult =
  | { ok: true; dryRun: boolean }
  | { ok: false; status: number; code: string; error: string };

/** Agent ID gate + one-per-wallet check. Skipped entirely with ARENA_DRY_RUN=1. */
export async function checkEligibility(wallet: Address): Promise<EligibilityResult> {
  if (isDryRun()) return { ok: true, dryRun: true };
  try {
    const [bal, minted] = await Promise.all([agentIdBalance(wallet), hasMintedOnChain(wallet)]);
    if (bal === 0n) {
      return {
        ok: false,
        status: 403,
        code: "no_agent_id",
        error: "This wallet holds no BNB Chain .ai Agent ID. Claim one first, then come back to the arena.",
      };
    }
    if (minted) {
      return {
        ok: false,
        status: 409,
        code: "already_minted",
        error: "This wallet already minted its Cogladius Gladiator (one per wallet). Next step: earn XLM on the Cogladius Stellar marketplace.",
      };
    }
    return { ok: true, dryRun: false };
  } catch (e: any) {
    return {
      ok: false,
      status: 502,
      code: "chain_unavailable",
      error: `Could not read BNB Chain right now (${String(e?.shortMessage || e?.message || e).slice(0, 160)}). Retry in a minute.`,
    };
  }
}

// ── Tier + voucher ───────────────────────────────────────────────────────────

/** 1 = Bronze (70-79), 2 = Silver (80-89), 3 = Gold (90-100), 0 = no pass. */
export function tierForScore(score: number): 0 | 1 | 2 | 3 {
  if (score >= 90) return 3;
  if (score >= 80) return 2;
  if (score >= 70) return 1;
  return 0;
}

export const TIER_NAMES = { 1: "Bronze", 2: "Silver", 3: "Gold" } as const;

export function taskHashFor(attemptId: Hex): Hex {
  return keccak256(attemptId);
}

export type Voucher = {
  to: Address;
  score: number;
  tier: number;
  taskHash: Hex;
  deadline: number;
  signature: Hex;
};

/** Sign a Mint voucher. Callers must only reach this after a judged pass. */
export async function signVoucher(d: { to: Address; score: number; tier: number; taskHash: Hex; deadline: number }): Promise<Voucher> {
  const key = signerKey();
  const contract = verifyingContract();
  if (!key || !contract) throw new Error("arena signer or contract not configured");
  if (d.score < ARENA_PASS_THRESHOLD || d.score > 100 || d.tier !== tierForScore(d.score)) {
    throw new Error("refusing to sign: score/tier out of range");
  }
  const to = getAddress(d.to);
  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData({
    domain: eip712Domain(contract),
    types: EIP712_TYPES,
    primaryType: "Mint",
    message: {
      to,
      score: d.score,
      tier: d.tier,
      taskHash: d.taskHash,
      deadline: BigInt(d.deadline),
    },
  });
  return { to, score: d.score, tier: d.tier, taskHash: d.taskHash, deadline: d.deadline, signature };
}

export function mintCalldata(v: Voucher): Hex {
  return encodeFunctionData({
    abi: GLADIATOR_ABI,
    functionName: "mint",
    args: [v.score, v.tier, v.taskHash, BigInt(v.deadline), v.signature],
  });
}

// ── Redis records ────────────────────────────────────────────────────────────

export type ArenaAttempt = {
  wallet: string; // lowercase
  agent: string; // Cogladius agent public key (G...)
  taskId: string;
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
  used: boolean;
};

export const attemptKey = (attemptId: string) => `arena:attempt:${attemptId}`;
export const attemptLockKey = (attemptId: string) => `arena:attempt-lock:${attemptId}`;
export const walletDailyKey = (wallet: string) => `arena:attempts:${wallet}`;
export const resultKey = (wallet: string) => `arena:result:${wallet}`;
export const STATS_KEY = "arena:stats";
export const MINTED_CACHE_KEY = "arena:minted-cache";

const g = globalThis as unknown as { __arenaStats?: Record<string, number> };
const memStats = (g.__arenaStats ??= {});

export async function statsIncr(field: "attempts" | "passes" | "linkedAgents" | "wrongResults"): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.hincrby(STATS_KEY, field, 1);
    return;
  }
  memStats[field] = (memStats[field] || 0) + 1;
}

export async function statsRead(): Promise<{ attempts: number; passes: number; linkedAgents: number; wrongResults: number }> {
  const r = getRedis();
  if (r) {
    const h = (await r.hgetall<Record<string, unknown>>(STATS_KEY)) || {};
    return { attempts: Number(h.attempts || 0), passes: Number(h.passes || 0), linkedAgents: Number(h.linkedAgents || 0), wrongResults: Number(h.wrongResults || 0) };
  }
  return { attempts: memStats.attempts || 0, passes: memStats.passes || 0, linkedAgents: memStats.linkedAgents || 0, wrongResults: memStats.wrongResults || 0 };
}

const AGENT_LINK_TTL_SECONDS = 365 * DAY_SECONDS;
const agentWalletKey = (pubkey: string) => `arena:agent-wallet:${pubkey}`;

const REGISTER_HINT =
  "Register on Cogladius first: run `npx -y cogladius join --json` (free, no funded account needed) and send the returned apiKey as `Authorization: Bearer <apiKey>`. See https://www.cogladius.xyz/arena/skill.md";

/** The registered Cogladius agent behind this request, or a ready error response. */
export async function requireAgent(req: Request): Promise<{ ok: true; agent: RegisteredAgent } | { ok: false; res: Response }> {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) return { ok: false, res: arenaError(401, "registration_required", REGISTER_HINT) };
  const agent = await validateApiKey(apiKey);
  if (!agent) return { ok: false, res: arenaError(403, "invalid_api_key", `Invalid or banned Cogladius API key. ${REGISTER_HINT}`) };
  return { ok: true, agent };
}

/** One Cogladius agent plays the arena for one wallet. Returns false if it is tied to another. */
export async function linkAgentWallet(pubkey: string, wallet: string): Promise<boolean> {
  const existing = await kvGet(agentWalletKey(pubkey));
  if (existing) return existing === wallet;
  await kvSet(agentWalletKey(pubkey), wallet, AGENT_LINK_TTL_SECONDS);
  await statsIncr("linkedAgents");
  return true;
}

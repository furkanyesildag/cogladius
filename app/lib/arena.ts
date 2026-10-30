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
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { getRedis } from "./redis";
import { kvCommit, kvGet, kvSet } from "./kv";
import { validateApiKey, type RegisteredAgent } from "./agentRegistry";

// ── Constants ────────────────────────────────────────────────────────────────

export const ARENA_CHAIN_ID = 56;
export const AGENT_ID_ADDRESS: Address = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
export const DEFAULT_BSC_RPC = "https://bsc-dataseed.bnbchain.org";
export const ARENA_PASS_THRESHOLD = 70;
export const MAX_SUPPLY = 5555;
// The arena pays for every free attempt, so it skips the reasoning model used for paid verdicts.
export const ARENA_JUDGE_MODEL = (process.env.ARENA_JUDGE_MODEL || "deepseek-chat").trim();

// The panel scored 94% of arena answers 90+, so scores said nothing. Score against this scale instead.
export const ARENA_JUDGE_NOTE =
  "Grade hard on this scale. A correct number with a generic method is 50-65. 70 needs the method applied to named records from the data, with the reasoning for each rule visible. 80 also needs a real edge case with its consequence worked out. 90+ is rare: a reviewer could not improve it. Do not reward length, formatting or confident tone.";
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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
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
    const [bal, minted, total] = await Promise.all([agentIdBalance(wallet), hasMintedOnChain(wallet), totalMintedOnChain()]);
    if (total != null && total >= MAX_SUPPLY) {
      return {
        ok: false,
        status: 410,
        code: "sold_out",
        error: "All 5,555 Cogladius Gladiators have been minted. Next step: earn XLM on the Cogladius Stellar marketplace.",
      };
    }
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
      error: "Could not read BNB Chain right now. Retry in a minute.",
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
  "Register on Cogladius first: run `npx -y cogladius join --json` (free, no funded account needed), read `apiKey` from ~/.cogladius/agent.json and send it as `Authorization: Bearer <apiKey>`. See https://www.cogladius.xyz/arena/skill.md";

/** The registered Cogladius agent behind this request, or a ready error response. */
export async function requireAgent(req: Request): Promise<{ ok: true; agent: RegisteredAgent } | { ok: false; res: Response }> {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) return { ok: false, res: arenaError(401, "registration_required", REGISTER_HINT) };
  let agent: RegisteredAgent | null;
  try {
    agent = await validateApiKey(apiKey);
  } catch {
    return { ok: false, res: arenaError(503, "registry_unavailable", "Could not check your API key right now. Retry in a minute.") };
  }
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

// ── Verified wallet link + Gladiator holder gate ─────────────────────────────
//
// `arena:agent-wallet:*` above is unsigned: anyone can name any wallet. It stays
// as it is for arena attempts, where a voucher is only useful to its own wallet,
// and must never be used to grant access. The gate below trusts only the
// `arena:verified-*` pair, written after an EIP-712 proof from the wallet.

export const LINK_NONCE_TTL_SECONDS = 10 * 60;

export const LINK_EIP712_DOMAIN = { name: "CogladiusArena", version: "1", chainId: ARENA_CHAIN_ID } as const;

export const LINK_EIP712_TYPES = {
  LinkAgent: [
    { name: "wallet", type: "address" },
    { name: "agent", type: "string" },
    { name: "nonce", type: "string" },
    { name: "statement", type: "string" },
  ],
} as const;

/** Keep this free of single quotes: it is pasted into a single-quoted shell argument. */
function linkStatement(wallet: Address, agent: string): string {
  return `This signature costs nothing, moves no funds and approves nothing. It links this wallet ${wallet} to the Cogladius Stellar agent ${agent}, replacing any agent linked to this wallet before.`;
}

/** Nonces are keyed to the agent and wallet they were issued for, so they fit no other pair. */
export const linkNonceKey = (agent: string, wallet: string, nonce: string) => `arena:link-nonce:${agent}:${wallet}:${nonce}`;
const verifiedWalletKey = (agent: string) => `arena:verified-wallet:${agent}`;
const verifiedAgentKey = (wallet: string) => `arena:verified-agent:${wallet}`;

/** The exact message the wallet signs. Rebuilt on verify, so the client controls no field of it. */
function linkMessage(wallet: Address, agent: string, nonce: string) {
  const checksummed = getAddress(wallet);
  return { wallet: checksummed, agent, nonce, statement: linkStatement(checksummed, agent) };
}

/** Everything an agent needs to sign the link challenge with `baw`. */
export function linkChallengePayload(wallet: Address, agent: string, nonce: string) {
  const message = linkMessage(wallet, agent, nonce);
  const typedData = {
    domain: LINK_EIP712_DOMAIN,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      ...LINK_EIP712_TYPES,
    },
    primaryType: "LinkAgent",
    message,
  };
  const signRequest = { method: "eth_signTypedData_v4", params: [message.wallet, JSON.stringify(typedData)] };
  const shellArg = JSON.stringify(signRequest).replace(/'/g, `'\\''`);
  return {
    typedData,
    signRequest,
    baw: {
      preview: `baw sign-message preview --binanceChainId ${ARENA_CHAIN_ID} --signType EIP712 --message '${shellArg}' --json`,
      execute: "baw sign-message execute --requestId <requestId> --json",
    },
  };
}

/**
 * Normalize a signature to 65 bytes (r||s||v, v = 27/28). Accepts a 65-byte
 * signature, or the r||s hex plus signatureRecovery "00"/"01" that `baw` returns.
 * Null when malformed.
 */
export function normalizeLinkSignature(signature: unknown, recovery?: unknown): Hex | null {
  if (typeof signature !== "string") return null;
  const hex = signature.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  let parity: number | null = null;
  if (recovery !== undefined && recovery !== null) {
    if (typeof recovery !== "string" || !/^(0x)?0[01]$/i.test(recovery.trim())) return null;
    parity = Number(recovery.trim().slice(-1));
  }

  if (hex.length === 130) {
    const v = parseInt(hex.slice(128), 16);
    if (![0, 1, 27, 28].includes(v)) return null;
    const signedParity = v >= 27 ? v - 27 : v;
    if (parity !== null && parity !== signedParity) return null;
    return `0x${hex.slice(0, 128)}${(27 + signedParity).toString(16)}`;
  }
  if (hex.length === 128 && parity !== null) {
    return `0x${hex}${(27 + parity).toString(16)}`;
  }
  return null;
}

/** True only if `wallet`'s own key signed the link message for this agent and nonce. */
export async function verifyLinkSignature(wallet: Address, agent: string, nonce: string, signature: Hex): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: getAddress(wallet),
      domain: LINK_EIP712_DOMAIN,
      types: LINK_EIP712_TYPES,
      primaryType: "LinkAgent",
      message: linkMessage(wallet, agent, nonce),
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Store a proven agent <-> wallet pair, one to one in both directions. Whatever
 * either side pointed at before is unlinked in the same atomic write. Two proofs
 * racing can leave one stale forward key; requireGladiatorHolder reads both
 * directions, so the loser fails closed and simply links again.
 */
export async function setVerifiedWallet(agent: string, wallet: string): Promise<{ replacedAgent: boolean }> {
  const [prevWallet, prevAgent] = await Promise.all([kvGet(verifiedWalletKey(agent)), kvGet(verifiedAgentKey(wallet))]);
  const del: string[] = [];
  if (prevWallet && prevWallet !== wallet && (await kvGet(verifiedAgentKey(prevWallet))) === agent) {
    del.push(verifiedAgentKey(prevWallet));
  }
  const replacedAgent = !!prevAgent && prevAgent !== agent;
  if (replacedAgent && (await kvGet(verifiedWalletKey(prevAgent!))) === wallet) {
    del.push(verifiedWalletKey(prevAgent!));
  }
  await kvCommit({ del, set: { [verifiedWalletKey(agent)]: wallet, [verifiedAgentKey(wallet)]: agent } });
  return { replacedAgent };
}

export async function gladiatorBalance(wallet: Address): Promise<bigint> {
  const c = gladiatorAddress();
  if (!c) throw new Error("Gladiator contract address is not configured");
  return bscClient().readContract({
    address: c,
    abi: GLADIATOR_ABI,
    functionName: "balanceOf",
    args: [getAddress(wallet)],
  });
}

export const GLADIATOR_LINK_HINT =
  "Prove your wallet: GET /api/arena/link/challenge?wallet=0xYOUR_WALLET with your Bearer key, sign the returned EIP-712 message (free, moves no funds), then POST /api/arena/link with {wallet, nonce, signature, signatureRecovery}. The wallet must hold a Cogladius Gladiator at submit time. Steps: https://www.cogladius.xyz/arena/skill.md";

export type GladiatorGateResult =
  | { ok: true; wallet: string }
  | { ok: false; status: 403; code: "gladiator_required"; reason: "no_verified_wallet" | "no_gladiator"; error: string; hint: string }
  | { ok: false; status: 503; code: "gate_unavailable"; error: string; retryable: true; retryAfter: number };

/**
 * Ok only if the agent has a signature-proven wallet AND that wallet holds a
 * Gladiator right now, read live from chain so a sold NFT loses access at once.
 * Fails closed: a store or RPC failure is a retryable 503, never a pass, and
 * ARENA_DRY_RUN does not bypass it.
 */
export async function requireGladiatorHolder(agent: string): Promise<GladiatorGateResult> {
  const unavailable = (what: string): GladiatorGateResult => ({
    ok: false,
    status: 503,
    code: "gate_unavailable",
    error: `Could not check Gladiator ownership right now (${what}). Nothing was submitted. Retry in a minute.`,
    retryable: true,
    retryAfter: 60,
  });

  let wallet: string | null;
  try {
    wallet = await kvGet(verifiedWalletKey(agent));
    if (wallet && (await kvGet(verifiedAgentKey(wallet))) !== agent) wallet = null;
  } catch {
    return unavailable("link store unavailable");
  }
  if (!wallet) {
    return {
      ok: false,
      status: 403,
      code: "gladiator_required",
      reason: "no_verified_wallet",
      error: "This task is for Cogladius Gladiator holders, and this agent has no signature-verified wallet.",
      hint: GLADIATOR_LINK_HINT,
    };
  }

  let balance: bigint;
  try {
    balance = await gladiatorBalance(wallet as Address);
  } catch {
    return unavailable("BNB Chain read failed");
  }
  if (balance > 0n) return { ok: true, wallet };
  return {
    ok: false,
    status: 403,
    code: "gladiator_required",
    reason: "no_gladiator",
    error: `This task is for Cogladius Gladiator holders, and the verified wallet ${wallet} holds none.`,
    hint: GLADIATOR_LINK_HINT,
  };
}

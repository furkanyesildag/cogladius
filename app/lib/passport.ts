/**
 * Gladiator Passport: records a BNB Chain Gladiator on Stellar through
 * contracts/gladiator-passport. Server-only.
 *
 * Most agents have an unfunded Stellar key, so the contract checks the agent's
 * ed25519 signature directly rather than using require_auth. The server adds an
 * attestation of what it just read from BNB Chain, and a sponsor account pays.
 *
 * Inert until PASSPORT_CONTRACT_ID, PASSPORT_ATTESTOR_SECRET and
 * PASSPORT_SUBMITTER_SECRET are set: without them both routes return 503.
 */

import { createHash } from "crypto";
import { Address as StellarAddress, Contract, Keypair, StrKey, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { BaseError, ContractFunctionRevertedError, getAddress, type Address } from "viem";
import { arenaError, arenaJson, bscClient, clientIp, getVerifiedWallet, gladiatorAddress, GLADIATOR_ABI, GLADIATOR_LINK_HINT, requireAgent, tierForScore } from "./arena";
import { EXPLORER_BASE, MAINNET_PASSPHRASE, NETWORK_PASSPHRASE } from "./constants";
import { kvIncr, kvIncrBy, kvTake } from "./kv";
import { getRedis } from "./redis";
import { decodeSignature, verifySep53 } from "./sep53";
import { getRpcServer, retryXdr } from "./sorobanServer";

// ── Message format: must match contracts/gladiator-passport/src/lib.rs byte for byte ──

const DOMAIN = "cogladius-gladiator-passport-v1";
const AGENT_PREFIX = "Cogladius Gladiator Passport v1 agent approval: ";
const ATTESTOR_PREFIX = "cogladius-gladiator-passport-v1:attestor:";

export type PassportFacts = { tokenId: number; score: number; tier: number; wallet: string };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

export function passportHash(contractId: string, networkPassphrase: string, agentPubkey: Buffer, f: PassportFacts, deadline: number): Buffer {
  const deadlineBytes = Buffer.alloc(8);
  deadlineBytes.writeBigUInt64BE(BigInt(deadline));
  return sha256(
    Buffer.concat([
      Buffer.from(DOMAIN, "utf8"),
      sha256(Buffer.from(networkPassphrase, "utf8")),
      new StellarAddress(contractId).toScVal().toXDR(),
      agentPubkey,
      u32be(f.tokenId),
      u32be(f.score),
      u32be(f.tier),
      Buffer.from(f.wallet.replace(/^0x/, ""), "hex"),
      deadlineBytes,
    ])
  );
}

/** The ASCII message the agent signs with SEP-53. */
export function agentMessage(hash: Buffer): string {
  return AGENT_PREFIX + hash.toString("hex");
}

// ── Limits ───────────────────────────────────────────────────────────────────

const DAY_SECONDS = 24 * 60 * 60;
/** How long a challenge lasts. Also the furthest deadline the attestor will sign. */
const DEADLINE_WINDOW_SECONDS = 10 * 60;
const TX_TIMEOUT_SECONDS = 30;
/** A deadline this close could lapse while the tx is in flight, costing a fee for nothing. */
const MIN_DEADLINE_MARGIN_SECONDS = TX_TIMEOUT_SECONDS + 15;
/** Outlives the tx's own time bound, so a holder that dies mid-flight blocks nothing for long. */
const SUBMIT_LOCK_TTL_SECONDS = 60;
const INCLUSION_FEE_STROOPS = "5000";

// A record measured 0.061 XLM on testnet, 99% of it rent. Mainnet rent differs, so check both before going live.
const DEFAULT_DAILY_CAP_STROOPS = 50 * 10_000_000; // 50 XLM a day, about 800 records
const DEFAULT_MAX_TX_FEE_STROOPS = 2_000_000; // 0.2 XLM

const RATE_LIMITS = {
  challenge: { windowSeconds: 600, perIp: 60, perAgent: 30 },
  submit: { windowSeconds: 3600, perIp: 30, perAgent: 10 },
} as const;

function positiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const unavailable = (what: string) =>
  arenaError(503, "passport_unavailable", `Passport is unavailable right now (${what}). Nothing was recorded or spent. Retry in a minute.`, { retryable: true, retryAfter: 60 });

/**
 * kv.ts falls back to a per-process map without Redis. That is fine for one local
 * dev server, but on serverless each instance would keep its own count, so the
 * caps would not be caps. Production therefore requires Redis.
 */
function limitStoreUsable(): boolean {
  return !!getRedis() || process.env.NODE_ENV !== "production";
}

/** Null when under the limit, otherwise the response to send. Fails closed. */
async function overLimit(key: string, windowSeconds: number, limit: number): Promise<Response | null> {
  try {
    if (!limitStoreUsable()) return unavailable("limit store not configured");
    if ((await kvIncr(key, windowSeconds)) <= limit) return null;
  } catch {
    return unavailable("limit store unavailable");
  }
  return arenaError(429, "rate_limited", `Too many passport requests; retry in ${windowSeconds} seconds.`, { retryAfter: windowSeconds });
}

// ── Configuration ────────────────────────────────────────────────────────────

type PassportConfig = { contractId: string; attestor: Keypair; submitter: Keypair };

function passportConfig(): PassportConfig | null {
  const contractId = (process.env.PASSPORT_CONTRACT_ID || "").trim();
  const attestor = (process.env.PASSPORT_ATTESTOR_SECRET || "").trim();
  const submitter = (process.env.PASSPORT_SUBMITTER_SECRET || "").trim();
  if (!StrKey.isValidContract(contractId)) return null;
  if (!StrKey.isValidEd25519SecretSeed(attestor) || !StrKey.isValidEd25519SecretSeed(submitter)) return null;
  return { contractId, attestor: Keypair.fromSecret(attestor), submitter: Keypair.fromSecret(submitter) };
}

const mainnetAllowed = () => process.env.PASSPORT_ALLOW_MAINNET === "true";

/**
 * Null when the RPC really serves the configured network, and that network is
 * allowed. Asks the RPC itself because the URL and the passphrase are set
 * separately and could disagree. Any failure refuses.
 */
async function networkRefusal(): Promise<Response | null> {
  const refused = () => arenaError(503, "passport_mainnet_refused", "Passport is not enabled on Stellar mainnet.");
  if (NETWORK_PASSPHRASE === MAINNET_PASSPHRASE && !mainnetAllowed()) return refused();
  let live: string;
  try {
    live = (await getRpcServer().getNetwork()).passphrase;
  } catch {
    return unavailable("Stellar RPC unavailable");
  }
  if (live === MAINNET_PASSPHRASE && !mainnetAllowed()) return refused();
  if (live !== NETWORK_PASSPHRASE) return unavailable("Stellar RPC is on a different network than configured");
  return null;
}

// ── Shared gate ──────────────────────────────────────────────────────────────

export type PassportContext = PassportConfig & { agent: string; agentPubkey: Buffer; facts: PassportFacts };

const TOKEN_ID_RE = /^[1-9][0-9]{0,9}$/;

/** Live from BNB Chain. Null when the token does not exist; throws on an RPC failure. */
async function readGladiator(contract: Address, tokenId: number): Promise<{ owner: string; score: number; tier: number } | null> {
  const id = BigInt(tokenId);
  const read = bscClient();
  try {
    const [owner, score, tier] = await Promise.all([
      read.readContract({ address: contract, abi: GLADIATOR_ABI, functionName: "ownerOf", args: [id] }),
      read.readContract({ address: contract, abi: GLADIATOR_ABI, functionName: "scoreOf", args: [id] }),
      read.readContract({ address: contract, abi: GLADIATOR_ABI, functionName: "tierOf", args: [id] }),
    ]);
    return { owner: owner.toLowerCase(), score, tier };
  } catch (e) {
    if (e instanceof BaseError && e.walk((c) => c instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return null;
    throw e;
  }
}

/**
 * Everything both routes require, cheapest and most abuse-resistant first:
 * configured, rate limits, API key, proven wallet, then the token as it stands
 * on BNB Chain right now.
 */
export async function passportGate(req: Request, rawTokenId: unknown, scope: keyof typeof RATE_LIMITS): Promise<{ ok: true; ctx: PassportContext } | { ok: false; res: Response }> {
  const fail = (res: Response) => ({ ok: false as const, res });

  const config = passportConfig();
  const contract = gladiatorAddress();
  if (!config || !contract) return fail(arenaError(503, "passport_not_configured", "Gladiator Passport is not enabled yet."));

  const tokenText = String(rawTokenId ?? "");
  if (!TOKEN_ID_RE.test(tokenText) || Number(tokenText) > 0xffffffff) {
    return fail(arenaError(400, "invalid_token_id", "tokenId must be a positive whole number."));
  }
  const tokenId = Number(tokenText);

  const limits = RATE_LIMITS[scope];
  const ipLimited = await overLimit(`arena:rate:passport:${scope}:ip:${clientIp(req)}`, limits.windowSeconds, limits.perIp);
  if (ipLimited) return fail(ipLimited);

  const auth = await requireAgent(req);
  if (!auth.ok) return fail(auth.res);
  const agent = auth.agent.pubkey;

  const agentLimited = await overLimit(`arena:rate:passport:${scope}:agent:${agent}`, limits.windowSeconds, limits.perAgent);
  if (agentLimited) return fail(agentLimited);

  if (!StrKey.isValidEd25519PublicKey(agent)) {
    return fail(arenaError(400, "agent_key_not_stellar", "This agent is registered with a key that is not a Stellar public key (G...)."));
  }

  const refusal = await networkRefusal();
  if (refusal) return fail(refusal);

  let wallet: string | null;
  try {
    wallet = await getVerifiedWallet(agent);
  } catch {
    return fail(unavailable("link store unavailable"));
  }
  if (!wallet) {
    return fail(arenaError(403, "wallet_not_verified", "This agent has no signature-verified wallet.", { hint: GLADIATOR_LINK_HINT }));
  }

  let token: Awaited<ReturnType<typeof readGladiator>>;
  try {
    token = await readGladiator(contract, tokenId);
  } catch {
    return fail(unavailable("BNB Chain read failed"));
  }
  if (!token) return fail(arenaError(404, "token_not_found", `Gladiator #${tokenId} does not exist.`));
  if (token.owner !== wallet.toLowerCase()) {
    return fail(arenaError(403, "not_token_owner", `Gladiator #${tokenId} is not held by this agent's verified wallet ${wallet}.`));
  }
  if (token.score < 70 || token.score > 100 || token.tier !== tierForScore(token.score)) {
    return fail(unavailable("unexpected token data"));
  }

  return {
    ok: true,
    ctx: {
      ...config,
      agent,
      agentPubkey: StrKey.decodeEd25519PublicKey(agent),
      facts: { tokenId, score: token.score, tier: token.tier, wallet: getAddress(token.owner) },
    },
  };
}

/** What the agent needs to see, check and sign. Holds no state: POST rebuilds it from live data. */
export function passportChallenge(ctx: PassportContext) {
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_WINDOW_SECONDS;
  const hash = passportHash(ctx.contractId, NETWORK_PASSPHRASE, ctx.agentPubkey, ctx.facts, deadline);
  return {
    agent: ctx.agent,
    ...ctx.facts,
    deadline,
    contractId: ctx.contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    message: agentMessage(hash),
    signing: "SEP-53: ed25519(sha256(\"Stellar Signed Message:\\n\" + message)) with the agent's Stellar key. It needs no funded account.",
    submit: "POST /api/arena/passport with { tokenId, deadline, signature }",
  };
}

// ── Sponsored submission ─────────────────────────────────────────────────────

const dayKey = () => `arena:passport:spend:${new Date().toISOString().slice(0, 10)}`;

function secondsToUtcMidnight(): number {
  const now = Date.now();
  return Math.ceil((Math.ceil(now / (DAY_SECONDS * 1000)) * DAY_SECONDS * 1000 - now) / 1000);
}

const CONTRACT_ERRORS: Record<string, [number, string, string]> = {
  "1": [409, "challenge_expired", "This challenge expired. Request a new one."],
  "2": [409, "token_already_recorded", "This Gladiator already has a passport."],
  "3": [409, "agent_already_recorded", "This agent already has a passport."],
};

function simulationFailure(error: string): Response {
  const code = /Error\(Contract, #(\d+)\)/.exec(error)?.[1];
  const known = code ? CONTRACT_ERRORS[code] : undefined;
  if (known) return arenaError(known[0], known[1], known[2]);
  // The agent's signature was already checked here, so this is our attestor key or the contract.
  if (/Error\(Crypto,/.test(error)) return unavailable("attestor key does not match the contract");
  return unavailable("simulation failed");
}

/**
 * Verify the agent's signature against facts read just now, attest, and submit.
 * One submission runs at a time: the sponsor has a single sequence number, and
 * simulating under the lock means concurrent duplicates are refused for free
 * rather than failing on chain at our cost.
 */
export async function submitPassport(ctx: PassportContext, rawDeadline: unknown, rawSignature: unknown): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(rawDeadline);
  if (!Number.isSafeInteger(deadline) || deadline > now + DEADLINE_WINDOW_SECONDS) {
    return arenaError(400, "invalid_deadline", "deadline must be the value returned by the challenge.");
  }
  if (deadline < now + MIN_DEADLINE_MARGIN_SECONDS) {
    return arenaError(409, "challenge_expired", "This challenge has expired or is about to. Request a new one.");
  }

  const hash = passportHash(ctx.contractId, NETWORK_PASSPHRASE, ctx.agentPubkey, ctx.facts, deadline);
  const agentSig = decodeSignature(String(rawSignature ?? ""));
  if (!agentSig || !verifySep53(ctx.agent, agentMessage(hash), agentSig.toString("hex"))) {
    return arenaError(403, "signature_mismatch", "The signature does not match this agent and challenge, or the token changed since it was issued. Request a new challenge.");
  }

  if (!limitStoreUsable()) return unavailable("limit store not configured");
  const lockKey = "arena:passport:submit-lock";
  try {
    if ((await kvIncr(lockKey, SUBMIT_LOCK_TTL_SECONDS)) !== 1) {
      return arenaError(503, "sponsor_busy", "Another passport is being submitted. Retry in a few seconds.", { retryable: true, retryAfter: 5 });
    }
  } catch {
    return unavailable("limit store unavailable");
  }

  const { response, releaseLock } = await submitLocked(ctx, hash, agentSig, deadline);
  // When a tx may still land, the lock stays until its TTL, past the tx's time bound.
  if (releaseLock) await kvTake(lockKey).catch(() => {});
  return response;
}

async function submitLocked(ctx: PassportContext, hash: Buffer, agentSig: Buffer, deadline: number): Promise<{ response: Response; releaseLock: boolean }> {
  const done = (response: Response) => ({ response, releaseLock: true });
  const server = getRpcServer();
  const attestorSig = ctx.attestor.sign(Buffer.concat([Buffer.from(ATTESTOR_PREFIX, "utf8"), hash]));

  let tx: ReturnType<ReturnType<typeof rpc.assembleTransaction>["build"]>;
  try {
    const source = await server.getAccount(ctx.submitter.publicKey());
    const built = new TransactionBuilder(source, { fee: INCLUSION_FEE_STROOPS, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        new Contract(ctx.contractId).call(
          "record",
          nativeToScVal(ctx.agentPubkey, { type: "bytes" }),
          nativeToScVal(ctx.facts.tokenId, { type: "u32" }),
          nativeToScVal(ctx.facts.score, { type: "u32" }),
          nativeToScVal(ctx.facts.tier, { type: "u32" }),
          nativeToScVal(Buffer.from(ctx.facts.wallet.slice(2), "hex"), { type: "bytes" }),
          nativeToScVal(BigInt(deadline), { type: "u64" }),
          nativeToScVal(agentSig, { type: "bytes" }),
          nativeToScVal(attestorSig, { type: "bytes" })
        )
      )
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();
    const sim = await retryXdr(() => server.simulateTransaction(built));
    if (rpc.Api.isSimulationError(sim)) return done(simulationFailure(sim.error));
    tx = rpc.assembleTransaction(built, sim).build();
  } catch {
    return done(unavailable("Stellar RPC unavailable"));
  }

  const maxFee = Number(tx.fee);
  if (maxFee > positiveIntEnv("PASSPORT_MAX_TX_FEE_STROOPS", DEFAULT_MAX_TX_FEE_STROOPS)) {
    return done(unavailable("fee above the per-transaction limit"));
  }

  // Reserve the most this tx can cost before it can spend anything, then correct it to what it did cost.
  const spendKey = dayKey();
  try {
    const spent = await kvIncrBy(spendKey, maxFee, 2 * DAY_SECONDS);
    if (spent > positiveIntEnv("PASSPORT_DAILY_CAP_STROOPS", DEFAULT_DAILY_CAP_STROOPS)) {
      await kvIncrBy(spendKey, -maxFee, 2 * DAY_SECONDS);
      return done(arenaError(503, "sponsor_cap_reached", "Today's sponsored passport budget is used up. Retry after 00:00 UTC.", { retryable: true, retryAfter: secondsToUtcMidnight() }));
    }
  } catch {
    return done(unavailable("spend cap could not be checked"));
  }
  const settleSpend = (actual: number) => kvIncrBy(spendKey, actual - maxFee, 2 * DAY_SECONDS).catch(() => 0);

  tx.sign(ctx.submitter);
  let hashHex: string;
  try {
    const sent = await server.sendTransaction(tx);
    if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
      // Refused before inclusion, so no fee was charged.
      await settleSpend(0);
      return done(unavailable("Stellar refused the transaction"));
    }
    hashHex = sent.hash;
  } catch {
    // Unknown whether it reached the network: keep the reservation and the lock.
    return { response: unavailable("Stellar RPC unavailable"), releaseLock: false };
  }

  const pollUntil = Date.now() + (TX_TIMEOUT_SECONDS + 10) * 1000;
  while (Date.now() < pollUntil) {
    await new Promise((r) => setTimeout(r, 2000));
    let res: rpc.Api.GetTransactionResponse;
    try {
      res = await retryXdr(() => server.getTransaction(hashHex));
    } catch {
      continue;
    }
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    await settleSpend(Number(res.resultXdr.feeCharged().toString()));
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return done(
        arenaJson({
          success: true,
          agent: ctx.agent,
          ...ctx.facts,
          contractId: ctx.contractId,
          txHash: hashHex,
          ledger: res.ledger,
          explorer: `${EXPLORER_BASE}/tx/${hashHex}`,
        })
      );
    }
    return done(unavailable(`transaction ${hashHex} failed on chain`));
  }
  return { response: unavailable(`transaction ${hashHex} not confirmed in time; check it before retrying`), releaseLock: false };
}

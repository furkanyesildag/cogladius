/**
 * Fresh XLM lifecycle proof on the live Cogladius escrow.
 *
 *   post_task -> release_to_winner   (settlement path)
 *   post_task -> refund              (cancel path)
 *
 * Reads secrets from app/.env.local. Never prints them.
 * Run:  node lifecycle.js [--dry]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SDK = path.join(REPO, "app/node_modules/@stellar/stellar-sdk");
const {
  Account, Address, Contract, Keypair, TransactionBuilder,
  nativeToScVal, scValToNative, rpc, Networks,
} = require(SDK);

// ---- env ----------------------------------------------------------------
for (const line of fs.readFileSync(path.join(REPO, "app/.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const DRY = process.argv.includes("--dry");
const ESCROW = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
const RPC_URL = process.env.SOROBAN_RPC_URL_SERVER;
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.PUBLIC;
const BASE_FEE = "2000000";

if (!ESCROW || !RPC_URL) throw new Error("ESCROW / RPC not configured");

const submitter = Keypair.fromSecret(process.env.SOROBAN_SUBMITTER_SECRET);
const verdict = Keypair.fromSecret(process.env.VERDICT_AUTHORITY_SECRET);
const server = new rpc.Server(RPC_URL);
const contract = new Contract(ESCROW);

// ---- verdict signing (mirrors app/lib/sorobanServer.ts) ------------------
const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

function signVerdict(taskId, winner, score, nonce) {
  const msg = Buffer.concat([
    u64be(BigInt(taskId)), u32be(score), u64be(nonce),
    new Address(winner).toScVal().toXDR(),
  ]);
  return verdict.sign(msg);
}

// ---- invocation ---------------------------------------------------------
async function invoke(label, name, args, signers = [submitter]) {
  process.stdout.write(`\n[${label}] ${name}(...)\n`);
  const source = await server.getAccount(submitter.publicKey());
  const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: BASE_FEE, networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(name, ...args))
    .setTimeout(120)
    .build();

  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (e) {
    process.stdout.write(`  simulation REJECTED: ${e.message}\n`);
    return { rejected: true, error: e.message };
  }
  if (DRY) { process.stdout.write("  (dry run, not submitted)\n"); return { dry: true }; }

  for (const s of signers) prepared.sign(s);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    process.stdout.write(`  submit ERROR: ${JSON.stringify(sent.errorResult)}\n`);
    return { rejected: true, hash: sent.hash };
  }
  for (let i = 0; i < 40; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === "SUCCESS") {
      process.stdout.write(`  OK  ${sent.hash}\n`);
      return { hash: sent.hash };
    }
    if (res.status === "FAILED") {
      process.stdout.write(`  FAILED on-chain  ${sent.hash}\n`);
      return { rejected: true, hash: sent.hash };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${name} not confirmed`);
}

async function readConfig() {
  const source = await server.getAccount(submitter.publicKey());
  const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: BASE_FEE, networkPassphrase: PASSPHRASE,
  }).addOperation(contract.call("get_config")).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  return scValToNative(sim.result.retval);
}

// ---- run ----------------------------------------------------------------
(async () => {
  const cfg = await readConfig();
  console.log("escrow      :", ESCROW);
  console.log("reward SAC  :", cfg.usdc_sac, "(legacy field name; native XLM SAC)");
  console.log("paused      :", cfg.paused);
  console.log("threshold   :", cfg.pass_threshold);
  console.log("settle_grace:", cfg.settle_grace);
  console.log("poster      :", submitter.publicKey());
  if (cfg.paused) throw new Error("contract is paused");

  const WINNER = process.env.LIFECYCLE_WINNER || submitter.publicKey();
  const REWARD = 10_000_000n; // 1 XLM (7 decimals)
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + 7200;
  const base = Number(process.env.LIFECYCLE_TASK_BASE || 0);
  if (!base) throw new Error("set LIFECYCLE_TASK_BASE to an unused task id");
  const idSettle = base;
  const idRefund = base + 1;

  console.log("winner      :", WINNER);
  console.log("task ids    :", idSettle, "(settle),", idRefund, "(refund)");

  const out = {};

  // --- settlement path ---
  out.post_settle = await invoke("1/5", "post_task", [
    new Address(submitter.publicKey()).toScVal(),
    nativeToScVal(BigInt(idSettle), { type: "u64" }),
    nativeToScVal(REWARD, { type: "i128" }),
    nativeToScVal(BigInt(deadline), { type: "u64" }),
  ]);

  // forged verdict must be refused on-chain before the real one is accepted
  const forged = Buffer.alloc(64, 7);
  out.forged = await invoke("2/5", "release_to_winner", [
    nativeToScVal(BigInt(idSettle), { type: "u64" }),
    new Address(WINNER).toScVal(),
    nativeToScVal(90, { type: "u32" }),
    nativeToScVal(BigInt(now), { type: "u64" }),
    nativeToScVal(forged, { type: "bytes" }),
  ]);

  const nonce = BigInt(Date.now());
  out.release = await invoke("3/5", "release_to_winner", [
    nativeToScVal(BigInt(idSettle), { type: "u64" }),
    new Address(WINNER).toScVal(),
    nativeToScVal(90, { type: "u32" }),
    nativeToScVal(nonce, { type: "u64" }),
    nativeToScVal(signVerdict(idSettle, WINNER, 90, nonce), { type: "bytes" }),
  ]);

  // --- refund path ---
  out.post_refund = await invoke("4/5", "post_task", [
    new Address(submitter.publicKey()).toScVal(),
    nativeToScVal(BigInt(idRefund), { type: "u64" }),
    nativeToScVal(REWARD, { type: "i128" }),
    nativeToScVal(BigInt(deadline), { type: "u64" }),
  ]);

  out.refund = await invoke("5/5", "refund", [
    nativeToScVal(BigInt(idRefund), { type: "u64" }),
  ]);

  console.log("\n==== hashes ====");
  for (const [k, v] of Object.entries(out)) {
    console.log(k.padEnd(12), v.hash || (v.rejected ? "REJECTED (as intended)" : "-"));
  }
  fs.writeFileSync(
    path.join(__dirname, "lifecycle-result.json"),
    JSON.stringify({ escrow: ESCROW, winner: WINNER, idSettle, idRefund, out }, null, 2)
  );
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

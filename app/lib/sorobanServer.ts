/**
 * Server-side Soroban helpers for the Cogladius escrow contract.
 *
 * The verdict authority signs the off-chain three-judge result; the contract
 * verifies that ed25519 signature on-chain before releasing the USDC reward.
 * A separate funded "submitter" account pays the transaction fee and acts as
 * the source for the `release_to_winner` invocation (the message signature and
 * the transaction signature are independent).
 *
 * Server-only — never import this into a client component.
 */

import {
  Account,
  Address,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import {
  ESCROW_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
} from "@/lib/constants";

const BASE_FEE = "1000000"; // generous fee for Soroban invocations

/**
 * Defensive retry for XDR decode errors from RPC (seen when mainnet nodes began
 * returning CAP-71 `AddressV2` auth before this app moved to stellar-sdk 16).
 * The failure happens before anything is signed or sent, so retrying is safe.
 */
async function retryXdr<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i >= attempts - 1 || !/XDR Read Error/i.test(String(err?.message))) throw err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

// Server code talks to the real upstream RPC directly (the client goes through
// the /api/soroban proxy). SOROBAN_RPC_URL_SERVER holds the secret mainnet URL;
// fall back to the public var only if it is a real absolute URL.
function serverRpcUrl(): string {
  const server = process.env.SOROBAN_RPC_URL_SERVER;
  if (server && /^https?:\/\//.test(server)) return server;
  if (/^https?:\/\//.test(SOROBAN_RPC_URL)) return SOROBAN_RPC_URL;
  throw new Error(
    "SOROBAN_RPC_URL_SERVER is not configured (server-side Soroban RPC URL)."
  );
}

export function getRpcServer(): rpc.Server {
  const url = serverRpcUrl();
  return new rpc.Server(url, { allowHttp: url.startsWith("http://") });
}

function verdictKeypair(): Keypair {
  const secret = process.env.VERDICT_AUTHORITY_SECRET;
  if (!secret) throw new Error("VERDICT_AUTHORITY_SECRET is not configured");
  return Keypair.fromSecret(secret);
}

function submitterKeypair(): Keypair {
  const secret = process.env.SOROBAN_SUBMITTER_SECRET;
  if (!secret) throw new Error("SOROBAN_SUBMITTER_SECRET is not configured");
  return Keypair.fromSecret(secret);
}

/** The verdict authority's raw 32-byte ed25519 public key (contract config). */
export function verdictPublicKeyHex(): string {
  return verdictKeypair().rawPublicKey().toString("hex");
}

function u64be(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
}
function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/**
 * Canonical verdict message, byte-identical to the contract's `verdict_message`:
 * `task_id(8 BE) || score(4 BE) || nonce(8 BE) || winner.toScVal().toXDR()`.
 */
export function buildVerdictMessage(
  taskId: number,
  winnerAddress: string,
  score: number,
  nonce: bigint
): Buffer {
  const addrXdr = new Address(winnerAddress).toScVal().toXDR(); // raw Buffer
  return Buffer.concat([
    u64be(BigInt(taskId)),
    u32be(score),
    u64be(nonce),
    addrXdr,
  ]);
}

/** Sign a verdict with the verdict authority's ed25519 key. */
export function signVerdict(
  taskId: number,
  winnerAddress: string,
  score: number,
  nonce: bigint
): Buffer {
  const msg = buildVerdictMessage(taskId, winnerAddress, score, nonce);
  return verdictKeypair().sign(msg); // raw 64-byte ed25519 signature
}

// All-zero ed25519 account, used only as the source of read-only simulations.
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function simulateRead(fn: string, ...args: any[]): Promise<any | null> {
  if (!ESCROW_CONTRACT_ID) return null;
  const server = getRpcServer();
  const { Contract, scValToNative } = await import("@stellar/stellar-sdk");
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(ESCROW_CONTRACT_ID).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await retryXdr(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`${fn} simulation failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  return retval ? scValToNative(retval) : null;
}

export type EscrowStatus = "Open" | "Active" | "Completed" | "Disputed" | "Refunded";
const STATUS_NAMES: EscrowStatus[] = ["Open", "Active", "Completed", "Disputed", "Refunded"];

export interface OnchainTask {
  poster: string;
  reward: bigint;
  deadline: number;
  status: EscrowStatus;
  winner: string | null;
}

/**
 * Read a task straight from the escrow contract. Returns null when the task id
 * has never been posted. Throws on RPC failure, so callers never mistake an
 * outage for "task does not exist".
 */
export async function getOnchainTask(taskId: number): Promise<OnchainTask | null> {
  const raw = await simulateRead("get_task", nativeToScVal(BigInt(taskId), { type: "u64" }));
  if (!raw) return null;
  // scValToNative renders a unit enum as either a number or a one-element array.
  const s = Array.isArray(raw.status) ? raw.status[0] : raw.status;
  const status = typeof s === "number" ? STATUS_NAMES[s] : (s as EscrowStatus);
  return {
    poster: String(raw.poster),
    reward: BigInt(raw.reward),
    deadline: Number(raw.deadline),
    status,
    winner: raw.winner ? String(raw.winner) : null,
  };
}

export async function getEscrowConfig(): Promise<{
  admin: string;
  passThreshold: number;
  settleGrace: number;
  paused: boolean;
} | null> {
  const raw = await simulateRead("get_config");
  if (!raw) return null;
  return {
    admin: String(raw.admin),
    passThreshold: Number(raw.pass_threshold),
    settleGrace: Number(raw.settle_grace ?? 0),
    paused: !!raw.paused,
  };
}

async function waitForTx(server: rpc.Server, hash: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Transaction ${hash} not confirmed in time`);
}

/**
 * Release a task's USDC reward to the winning agent by invoking
 * `release_to_winner` with a fresh verdict signature. Returns the tx hash.
 */
export async function releaseToWinner(
  taskId: number,
  winnerAddress: string,
  score: number
): Promise<{ hash: string; nonce: string }> {
  if (!ESCROW_CONTRACT_ID) throw new Error("ESCROW_CONTRACT_ID is not configured");
  const server = getRpcServer();
  const submitter = submitterKeypair();

  const nonce = BigInt(Date.now());
  const signature = signVerdict(taskId, winnerAddress, score, nonce);

  const source = await server.getAccount(submitter.publicKey());
  const { Contract } = await import("@stellar/stellar-sdk");
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const op = contract.call(
    "release_to_winner",
    nativeToScVal(BigInt(taskId), { type: "u64" }),
    new Address(winnerAddress).toScVal(),
    nativeToScVal(score, { type: "u32" }),
    nativeToScVal(nonce, { type: "u64" }),
    nativeToScVal(signature, { type: "bytes" })
  );

  const tx = new TransactionBuilder(source as Account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const prepared = await retryXdr(() => server.prepareTransaction(tx));
  prepared.sign(submitter);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`release_to_winner submission failed: ${JSON.stringify(sent.errorResult)}`);
  }
  await waitForTx(server, sent.hash);
  return { hash: sent.hash, nonce: nonce.toString() };
}

/**
 * Flag a completed task as disputed on-chain (admin-only state transition).
 * Full Agent Court resolution on Stellar is a deferred deliverable.
 */
export async function flagDisputed(taskId: number): Promise<{ hash: string }> {
  if (!ESCROW_CONTRACT_ID) throw new Error("ESCROW_CONTRACT_ID is not configured");
  const server = getRpcServer();
  const submitter = submitterKeypair();
  const source = await server.getAccount(submitter.publicKey());
  const { Contract } = await import("@stellar/stellar-sdk");
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const op = contract.call(
    "flag_disputed",
    nativeToScVal(BigInt(taskId), { type: "u64" })
  );
  const tx = new TransactionBuilder(source as Account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const prepared = await retryXdr(() => server.prepareTransaction(tx));
  prepared.sign(submitter);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`flag_disputed submission failed: ${JSON.stringify(sent.errorResult)}`);
  }
  await waitForTx(server, sent.hash);
  return { hash: sent.hash };
}

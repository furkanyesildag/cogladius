"use client";

/**
 * Client-side Soroban escrow integration.
 *
 * Posters connect Freighter, set a USDC reward, and sign a single
 * `post_task` contract call that locks the reward in the escrow contract.
 * Everything here runs in the browser and signs through the connected wallet
 * (Stellar Wallets Kit: Freighter, xBull, Albedo, Lobstr, ...).
 */

import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  authorizeEntry,
  xdr,
  StrKey,
} from "@stellar/stellar-sdk";
import { signTransaction, signMessage, signAuthEntry } from "@/lib/walletKit";
import { settleMessage, disputeMessage } from "@/lib/actionMessages";
import {
  ESCROW_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
  usdcToStroops,
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

// All-zero ed25519 account, used only as the source of read-only simulations.
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Resolve the client RPC URL. It is normally the same-origin proxy
 * (`/api/soroban`) so the mainnet RPC secret stays server-side; the SDK needs
 * an absolute URL, so relative paths are resolved against the page origin.
 */
function clientRpcUrl(): string {
  const u = SOROBAN_RPC_URL;
  if (u.startsWith("/") && typeof window !== "undefined") {
    return window.location.origin + u;
  }
  return u;
}

function getServer(): rpc.Server {
  const url = clientRpcUrl();
  return new rpc.Server(url, { allowHttp: url.startsWith("http://") });
}

async function waitForSuccess(server: rpc.Server, hash: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("Transaction failed on-chain");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Transaction not confirmed in time");
}

/**
 * Lock a task's USDC reward in the Soroban escrow contract.
 * Builds `post_task`, simulates + assembles it, signs with Freighter, and
 * submits to Soroban RPC. Returns the on-chain transaction hash.
 */
export async function postTaskOnChain(params: {
  posterAddress: string;
  taskId: number;
  rewardUsdc: number;
  deadline: number; // unix seconds
}): Promise<{ hash: string }> {
  if (!ESCROW_CONTRACT_ID) {
    throw new Error(
      "Escrow contract not configured (set NEXT_PUBLIC_ESCROW_CONTRACT_ID)."
    );
  }
  const { posterAddress, taskId, rewardUsdc, deadline } = params;
  const server = getServer();
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const op = contract.call(
    "post_task",
    new Address(posterAddress).toScVal(),
    nativeToScVal(BigInt(taskId), { type: "u64" }),
    nativeToScVal(usdcToStroops(rewardUsdc), { type: "i128" }),
    nativeToScVal(BigInt(deadline), { type: "u64" })
  );

  const source = await server.getAccount(posterAddress);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const prepared = await retryXdr(() => server.prepareTransaction(tx));

  const { signedTxXdr, error } = await signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: posterAddress,
  });
  if (error) {
    throw new Error(typeof error === "string" ? error : "Wallet signing failed");
  }

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(signed as any);
  if (sent.status === "ERROR") {
    throw new Error(
      `post_task submission failed: ${JSON.stringify(sent.errorResult)}`
    );
  }
  await waitForSuccess(server, sent.hash);
  return { hash: sent.hash };
}

/** The fee-sponsoring relayer, or null when this deployment has none. */
export async function relayerInfo(): Promise<{ relayer: string } | null> {
  try {
    const r = await fetch("/api/relay/post-task").then((x) => x.json());
    return r?.success && r.relayer ? { relayer: r.relayer } : null;
  } catch {
    return null;
  }
}

/**
 * Lock a reward with the network fee paid by the relayer. The poster signs
 * only the Soroban authorization entry for post_task (Freighter signAuthEntry);
 * the relayer is the transaction source, checks the entry authorizes exactly
 * this call, and submits it.
 */
export async function postTaskSponsored(params: {
  posterAddress: string;
  taskId: number;
  rewardUsdc: number;
  deadline: number;
}): Promise<{ hash: string; feePaidByRelayer: string }> {
  if (!ESCROW_CONTRACT_ID) throw new Error("Escrow contract not configured.");
  const info = await relayerInfo();
  if (!info) throw new Error("Fee sponsorship is not available right now.");
  const { posterAddress, taskId, rewardUsdc, deadline } = params;
  const server = getServer();
  const reward = usdcToStroops(rewardUsdc);
  const op = new Contract(ESCROW_CONTRACT_ID).call(
    "post_task",
    new Address(posterAddress).toScVal(),
    nativeToScVal(BigInt(taskId), { type: "u64" }),
    nativeToScVal(reward, { type: "i128" }),
    nativeToScVal(BigInt(deadline), { type: "u64" })
  );
  const source = await server.getAccount(info.relayer);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(120)
    .build();
  const sim = await retryXdr(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);

  // Mainnet RPC records address auth as CAP-71 AddressV2; accept either arm.
  const entries = (sim.result?.auth ?? []).filter((e) => {
    const c: any = e.credentials();
    const kind = c.switch().name;
    const creds = kind === "sorobanCredentialsAddress" ? c.address() : kind === "sorobanCredentialsAddressV2" ? c.addressV2() : null;
    if (!creds) return false;
    const a = creds.address();
    return a.switch().name === "scAddressTypeAccount" && StrKey.encodeEd25519PublicKey(a.accountId().ed25519()) === posterAddress;
  });
  if (entries.length !== 1) throw new Error("Unexpected authorization request from the escrow.");

  const signed = await authorizeEntry(
    entries[0],
    async (preimage: xdr.HashIdPreimage) => {
      const res: any = await signAuthEntry(preimage.toXDR("base64"), { networkPassphrase: NETWORK_PASSPHRASE, address: posterAddress });
      if (res.error || !res.signedAuthEntry) throw new Error(typeof res.error === "string" ? res.error : res.error?.message || "Wallet declined to sign");
      return { signature: Buffer.from(res.signedAuthEntry, "base64"), publicKey: posterAddress };
    },
    sim.latestLedger + 60,
    NETWORK_PASSPHRASE
  );

  const res = await fetch("/api/relay/post-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      poster: posterAddress,
      taskId: String(taskId),
      reward: reward.toString(),
      deadline,
      authEntries: [signed.toXDR("base64")],
    }),
  }).then((x) => x.json());
  if (!res.success) throw new Error(res.error || "Relayer rejected the post");
  return { hash: res.hash, feePaidByRelayer: res.feePaidByRelayer };
}

/** Read a task's on-chain state via simulation (no signature / no fee). */
export async function getTaskOnChain(taskId: number): Promise<any | null> {
  if (!ESCROW_CONTRACT_ID) return null;
  const server = getServer();
  const contract = new Contract(ESCROW_CONTRACT_ID);
  // Read-only simulation: any valid address works as the source. Use the
  // all-zero ed25519 account so this does not depend on any asset config.
  const dummy = new Account(SIMULATION_SOURCE, "0");
  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_task", nativeToScVal(BigInt(taskId), { type: "u64" }))
    )
    .setTimeout(30)
    .build();

  const sim = await retryXdr(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) return null;
  const retval = sim.result?.retval;
  if (!retval) return null;
  try {
    return scValToNative(retval);
  } catch {
    return null;
  }
}

/** Ask Freighter for a SEP-53 signature over `message` (base64 result). */
async function signWithWallet(message: string, address: string): Promise<string> {
  const res: any = await signMessage(message, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (res.error || !res.signedMessage) {
    throw new Error(typeof res.error === "string" ? res.error : res.error?.message || "Wallet declined to sign");
  }
  if (res.signerAddress && res.signerAddress !== address) {
    throw new Error("Freighter signed with a different account than the task poster");
  }
  // Freighter v4 returns base64; older versions return a Buffer.
  return typeof res.signedMessage === "string"
    ? res.signedMessage
    : Buffer.from(res.signedMessage).toString("base64");
}

/**
 * Release a task's reward as its poster: sign the release with Freighter, then
 * let the server check the signature and invoke `release_to_winner`.
 */
export async function settleAsPoster(params: {
  taskId: number;
  contractTaskId: number;
  posterAddress: string;
  winnerAddress: string;
}): Promise<any> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const posterSignature = await signWithWallet(
    settleMessage(params.contractTaskId, params.winnerAddress, issuedAt),
    params.posterAddress
  );
  const res = await fetch("/api/stellar/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: params.taskId,
      winnerAddress: params.winnerAddress,
      issuedAt,
      posterSignature,
    }),
  });
  return res.json();
}

/** Open an on-chain dispute as the task's poster (signed with Freighter). */
export async function disputeAsPoster(params: {
  taskId: number;
  contractTaskId: number;
  posterAddress: string;
}): Promise<any> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const posterSignature = await signWithWallet(
    disputeMessage(params.contractTaskId, issuedAt),
    params.posterAddress
  );
  const res = await fetch("/api/stellar/dispute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: params.taskId, issuedAt, posterSignature }),
  });
  return res.json();
}

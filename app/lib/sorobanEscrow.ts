"use client";

/**
 * Client-side Soroban escrow integration.
 *
 * Posters connect Freighter, set a USDC reward, and sign a single
 * `post_task` contract call that locks the reward in the escrow contract.
 * Everything here runs in the browser and signs through Freighter (SEP-43).
 */

import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import {
  ESCROW_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
  USDC_ISSUER,
  usdcToStroops,
} from "@/lib/constants";

const BASE_FEE = "1000000"; // generous fee for Soroban invocations

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

  const prepared = await server.prepareTransaction(tx);

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

/** Read a task's on-chain state via simulation (no signature / no fee). */
export async function getTaskOnChain(taskId: number): Promise<any | null> {
  if (!ESCROW_CONTRACT_ID) return null;
  const server = getServer();
  const contract = new Contract(ESCROW_CONTRACT_ID);
  // Read-only simulation: any valid address works as the source.
  const dummy = new Account(USDC_ISSUER, "0");
  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_task", nativeToScVal(BigInt(taskId), { type: "u64" }))
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  const retval = sim.result?.retval;
  if (!retval) return null;
  try {
    return scValToNative(retval);
  } catch {
    return null;
  }
}

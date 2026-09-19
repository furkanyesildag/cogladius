/**
 * Thin Soroban helpers: read-only simulation, invoke-and-wait, and signing of
 * address-credential auth entries through an `AgentSigner`.
 *
 * Every transaction is built with the Stellar JavaScript SDK; nothing here
 * implements cryptography or settlement logic of its own.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  Transaction,
  Operation,
  StrKey,
  authorizeEntry,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./network.js";
import { authContextOf, type AgentSigner } from "./signer.js";

/** All-zero account: a valid source for read-only simulations. */
export const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// Inclusion-fee bid (0.001 XLM): far above current mainnet Soroban inclusion
// fees (100-200 stroops), small enough that it does not tie up balance. The
// resource fee comes from simulation and is added on top by assembleTransaction.
export const DEFAULT_FEE = "10000";

export class RpcError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

export class SimulationError extends Error {
  constructor(readonly fn: string, readonly detail: string) {
    super(`${fn}: simulation failed: ${detail}`);
    this.name = "SimulationError";
  }
}

export function rpcServer(net: NetworkConfig): rpc.Server {
  return new rpc.Server(net.rpcUrl, { allowHttp: net.rpcUrl.startsWith("http://") });
}

/** Retry transient RPC failures (network errors, 5xx, 429) with backoff. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status ?? err?.status;
      const transient =
        status === undefined || status === 429 || (status >= 500 && status < 600) || /ECONN|ETIMEDOUT|fetch failed|socket/i.test(String(err?.message));
      if (!transient || i === attempts - 1) break;
      await sleep(400 * 2 ** i);
    }
  }
  throw new RpcError(`${label}: ${(lastErr as any)?.message ?? lastErr}`, lastErr);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulate a read-only call and decode its return value. */
export async function simulateRead(
  net: NetworkConfig,
  contractId: string,
  fn: string,
  args: xdr.ScVal[] = []
): Promise<any> {
  const server = rpcServer(net);
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: DEFAULT_FEE,
    networkPassphrase: net.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await withRetry(`simulate ${fn}`, () => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new SimulationError(fn, sim.error);
  const retval = sim.result?.retval;
  return retval ? scValToNative(retval) : null;
}

export interface InvokeResult {
  hash: string;
  returnValue: any;
  ledger: number;
}

/**
 * Build a contract call, simulate it, sign the auth entries that belong to
 * `authSigner` (address credentials), and return the assembled transaction
 * ready for an envelope signature. When `sourcePublicKey` is someone else (a
 * fee sponsor), the returned auth entries are what the sponsor needs.
 */
export async function prepareInvocation(
  net: NetworkConfig,
  sourcePublicKey: string,
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  authSigner?: AgentSigner,
  opts: { fee?: string; timeoutSeconds?: number; authValidForLedgers?: number } = {}
): Promise<{ tx: Transaction; signedAuth: xdr.SorobanAuthorizationEntry[] }> {
  const server = rpcServer(net);
  const acct = await withRetry("getAccount", () => server.getAccount(sourcePublicKey));
  const seq = acct.sequenceNumber();
  const build = (op: xdr.Operation) =>
    new TransactionBuilder(new Account(sourcePublicKey, seq), {
      fee: opts.fee ?? DEFAULT_FEE,
      networkPassphrase: net.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(opts.timeoutSeconds ?? 120)
      .build();

  const call = new Contract(contractId).call(fn, ...args);
  const tx1 = build(call);
  const sim1 = await withRetry(`simulate ${fn}`, () => server.simulateTransaction(tx1));
  if (rpc.Api.isSimulationError(sim1)) throw new SimulationError(fn, sim1.error);

  const auth = sim1.result?.auth ?? [];
  const mine = (e: xdr.SorobanAuthorizationEntry) => authAccount(e) === authSigner?.publicKey;
  if (!authSigner || !auth.some(mine)) {
    return { tx: rpc.assembleTransaction(tx1, sim1).build(), signedAuth: [] };
  }

  const ledger = sim1.latestLedger;
  const signedAuth: xdr.SorobanAuthorizationEntry[] = [];
  for (const e of auth) {
    signedAuth.push(mine(e) ? await signAuthEntryWith(net, authSigner, e, ledger + (opts.authValidForLedgers ?? 60)) : e);
  }
  const func = call.body().invokeHostFunctionOp().hostFunction();
  const tx2 = build(Operation.invokeHostFunction({ func, auth: signedAuth }));
  // Enforcing-mode simulation with the signed entries: accounts for the
  // signature check in the resource estimate and fails early on a bad signature.
  const sim2 = await withRetry(`re-simulate ${fn}`, () => server.simulateTransaction(tx2));
  if (rpc.Api.isSimulationError(sim2)) throw new SimulationError(fn, sim2.error);
  return { tx: rpc.assembleTransaction(tx2, sim2).build(), signedAuth };
}

/**
 * The address credentials of an auth entry, whatever its format: legacy
 * `Address`, CAP-71 `AddressV2` (address bound into the signed payload), or
 * `AddressWithDelegates`. Mainnet RPC returns V2 for recorded auth, so code
 * must never assume the legacy arm. Null for source-account credentials.
 */
export function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials | null {
  const c = entry.credentials();
  switch (c.switch().name) {
    case "sorobanCredentialsAddress":
      return c.address();
    case "sorobanCredentialsAddressV2":
      return (c as any).addressV2();
    case "sorobanCredentialsAddressWithDelegates":
      return (c as any).addressWithDelegates().addressCredentials();
    default:
      return null;
  }
}

/** The G-address an address-credential auth entry is for, if any. */
export function authAccount(entry: xdr.SorobanAuthorizationEntry): string | undefined {
  const creds = addressCredentials(entry);
  if (!creds) return undefined;
  const addr = creds.address();
  if (addr.switch().name !== "scAddressTypeAccount") return undefined;
  return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
}

/**
 * Build, simulate, sign and submit a contract call with `signer` as the
 * transaction source, then wait for it to land.
 */
export async function invoke(
  net: NetworkConfig,
  signer: AgentSigner,
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  opts: { fee?: string; timeoutSeconds?: number } = {}
): Promise<InvokeResult> {
  const { tx } = await prepareInvocation(net, signer.publicKey, contractId, fn, args, signer, opts);
  return signAndSubmit(net, signer, tx);
}

export async function latestLedger(net: NetworkConfig): Promise<number> {
  const server = rpcServer(net);
  const l = await withRetry("getLatestLedger", () => server.getLatestLedger());
  return l.sequence;
}

/** Sign one auth entry with an AgentSigner (policy-checked). */
export function signAuthEntryWith(
  net: NetworkConfig,
  signer: AgentSigner,
  entry: xdr.SorobanAuthorizationEntry,
  validUntilLedger: number
): Promise<xdr.SorobanAuthorizationEntry> {
  const ctx = authContextOf(entry);
  return authorizeEntry(
    entry,
    async (preimage: xdr.HashIdPreimage) => ({
      signature: Buffer.from(await signer.signAuthEntry(preimage, ctx)),
      publicKey: signer.publicKey,
    }),
    validUntilLedger,
    net.networkPassphrase
  );
}

export async function signAndSubmit(net: NetworkConfig, signer: AgentSigner, tx: Transaction): Promise<InvokeResult> {
  const sig = await signer.signTransactionHash(tx.hash());
  tx.addSignature(signer.publicKey, Buffer.from(sig).toString("base64"));
  return submitAndWait(net, tx);
}

export async function submitAndWait(net: NetworkConfig, tx: Transaction | any): Promise<InvokeResult> {
  const server = rpcServer(net);
  const sent = await withRetry("sendTransaction", () => server.sendTransaction(tx));
  if (sent.status === "ERROR") {
    const code = sent.errorResult?.result().switch().name ?? "unknown";
    let inner = "";
    try {
      inner = (sent.errorResult as any)?.result().innerResultPair?.().result().result().switch().name ?? "";
    } catch {}
    throw new Error(`transaction rejected: ${code}${inner ? ` (${inner})` : ""}`);
  }
  if (sent.status === "TRY_AGAIN_LATER") throw new RpcError("RPC asked to retry later");
  return waitForTx(net, sent.hash);
}

export async function waitForTx(net: NetworkConfig, hash: string, timeoutMs = 60_000): Promise<InvokeResult> {
  const server = rpcServer(net);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let res: rpc.Api.GetTransactionResponse | undefined;
    try {
      res = await server.getTransaction(hash);
    } catch {
      // RPC gap: keep polling until the timeout instead of failing a tx that may have landed.
    }
    if (res?.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const rv = (res as any).returnValue as xdr.ScVal | undefined;
      return { hash, ledger: res.ledger, returnValue: rv ? safeNative(rv) : null };
    }
    if (res?.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction ${hash} failed on-chain`);
    }
    await sleep(1500);
  }
  throw new RpcError(`transaction ${hash} not confirmed within ${timeoutMs / 1000}s (it may still land; check the explorer)`);
}

function safeNative(v: xdr.ScVal): any {
  try {
    return scValToNative(v);
  } catch {
    return v.toXDR("base64");
  }
}

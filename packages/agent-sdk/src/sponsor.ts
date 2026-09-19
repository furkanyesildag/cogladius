/**
 * Fee-sponsored `post_task`.
 *
 * The poster signs only the Soroban authorization entry for `post_task`; a
 * relayer account is the transaction source and pays the network fee. The
 * poster never needs to hold anything for fees beyond the reward itself.
 *
 * Client side: `postTaskSponsored` (signs the entry, sends it to a relayer).
 * Relayer side: `relaySponsoredPostTask` (checks the entry authorizes exactly
 * the expected call and nothing else, then submits it).
 */

import { Address, Contract, Keypair, Operation, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./network.js";
import type { AgentSigner } from "./signer.js";
import { EscrowClient } from "./escrow.js";
import { addressCredentials, authAccount, rpcServer, submitAndWait, withRetry, SimulationError, DEFAULT_FEE, type InvokeResult } from "./soroban.js";

export interface SponsoredPostRequest {
  poster: string;
  taskId: string; // u64 as decimal string
  reward: string; // stroops
  deadline: number;
  authEntries: string[]; // base64 XDR SorobanAuthorizationEntry
}

export class RelayRejected extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RelayRejected";
  }
}

/** Client: sign the post_task auth entry and hand it to a relayer. */
export async function postTaskSponsored(opts: {
  net: NetworkConfig;
  poster: AgentSigner;
  relayerUrl?: string;
  taskId: bigint;
  reward: bigint;
  deadline: number;
  fetch?: typeof fetch;
}): Promise<InvokeResult & { relayer: string }> {
  const f = opts.fetch ?? globalThis.fetch;
  const base = (opts.relayerUrl ?? `${opts.net.apiBaseUrl}/api/relay/post-task`).replace(/\/+$/, "");
  const info: any = await f(base).then((r) => r.json());
  if (!info?.relayer) throw new RelayRejected("relayer did not advertise its account", "no_relayer");
  const escrow = new EscrowClient(opts.net);
  const authEntries = await escrow.signSponsoredPost(opts.poster, info.relayer, opts);
  const body: SponsoredPostRequest = {
    poster: opts.poster.publicKey,
    taskId: opts.taskId.toString(),
    reward: opts.reward.toString(),
    deadline: opts.deadline,
    authEntries,
  };
  const res = await f(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new RelayRejected(data.error || `relay failed (HTTP ${res.status})`, data.code || "relay_failed");
  return { hash: data.hash, ledger: data.ledger, returnValue: null, relayer: info.relayer };
}

/**
 * Relayer: validate and submit a sponsored post_task.
 *
 * Checks, in order: exactly one auth entry; it is for `poster` with address
 * credentials; its root invocation is `escrow.post_task(poster, taskId,
 * reward, deadline)` with exactly the expected arguments; its only
 * sub-invocation is the reward transfer on the escrow's reward asset; its
 * signature expires soon; the simulated fee is under `maxFeeStroops`.
 */
export async function relaySponsoredPostTask(opts: {
  net: NetworkConfig;
  relayer: Keypair;
  request: SponsoredPostRequest;
  maxFeeStroops: number;
  maxAuthValidityLedgers?: number;
}): Promise<InvokeResult & { feeCharged: number }> {
  const { net, relayer, request } = opts;
  const escrowId = net.escrowContractId;
  if (!Array.isArray(request.authEntries) || request.authEntries.length !== 1) {
    throw new RelayRejected("expected exactly one authorization entry", "auth_count");
  }
  let entry: xdr.SorobanAuthorizationEntry;
  try {
    entry = xdr.SorobanAuthorizationEntry.fromXDR(request.authEntries[0], "base64");
  } catch {
    throw new RelayRejected("authorization entry is not valid XDR", "auth_xdr");
  }
  if (authAccount(entry) !== request.poster) throw new RelayRejected("authorization entry is not signed for the poster", "auth_signer");
  if (entry.credentials().switch().name === "sorobanCredentialsAddressWithDelegates") {
    throw new RelayRejected("delegated authorization is not accepted", "auth_delegates");
  }

  const root = entry.rootInvocation();
  const fn = root.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") throw new RelayRejected("entry does not authorize a contract call", "auth_fn");
  const call = fn.contractFn();
  if (Address.fromScAddress(call.contractAddress()).toString() !== escrowId || call.functionName().toString() !== "post_task") {
    throw new RelayRejected("entry must authorize escrow.post_task only", "auth_target");
  }
  const args = call.args().map((a) => scValToNative(a));
  const expected = [request.poster, BigInt(request.taskId), BigInt(request.reward), BigInt(request.deadline)];
  if (
    args.length !== 4 ||
    String(args[0]) !== expected[0] ||
    BigInt(args[1]) !== expected[1] ||
    BigInt(args[2]) !== expected[2] ||
    BigInt(args[3]) !== expected[3]
  ) {
    throw new RelayRejected("entry arguments do not match the request", "auth_args");
  }
  if (BigInt(request.reward) <= 0n) throw new RelayRejected("reward must be positive", "reward");

  for (const sub of root.subInvocations()) {
    const sf = sub.function();
    if (sf.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") throw new RelayRejected("unexpected nested authorization", "auth_nested");
    const sc = sf.contractFn();
    const target = Address.fromScAddress(sc.contractAddress()).toString();
    const sargs = sc.args().map((a) => scValToNative(a));
    const isRewardTransfer =
      target === net.rewardAssetContractId &&
      sc.functionName().toString() === "transfer" &&
      String(sargs[0]) === request.poster &&
      String(sargs[1]) === escrowId &&
      BigInt(sargs[2]) === BigInt(request.reward) &&
      sub.subInvocations().length === 0;
    if (!isRewardTransfer) throw new RelayRejected("entry authorizes something other than the reward transfer", "auth_nested");
  }

  const server = rpcServer(net);
  const latest = (await withRetry("getLatestLedger", () => server.getLatestLedger())).sequence;
  const expiry = addressCredentials(entry)!.signatureExpirationLedger();
  if (expiry <= latest) throw new RelayRejected("authorization entry has expired", "auth_expired");
  if (expiry > latest + (opts.maxAuthValidityLedgers ?? 200)) throw new RelayRejected("authorization entry is valid for too long", "auth_ttl");

  const source = await withRetry("getAccount", () => server.getAccount(relayer.publicKey()));
  const func = new Contract(escrowId)
    .call("post_task", ...call.args())
    .body()
    .invokeHostFunctionOp()
    .hostFunction();
  const tx = new TransactionBuilder(source, { fee: DEFAULT_FEE, networkPassphrase: net.networkPassphrase })
    .addOperation(Operation.invokeHostFunction({ func, auth: [entry] }))
    .setTimeout(60)
    .build();
  const sim = await withRetry("simulate post_task", () => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new SimulationError("post_task", sim.error);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const fee = Number(prepared.fee);
  if (fee > opts.maxFeeStroops) throw new RelayRejected(`fee ${fee} exceeds the relayer cap ${opts.maxFeeStroops}`, "fee_cap");
  prepared.sign(relayer);
  const res = await submitAndWait(net, prepared);
  return { ...res, feeCharged: fee };
}

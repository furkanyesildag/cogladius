/**
 * Failure path: the funder starts a unilateral close, and the provider's
 * watchdog answers it by closing with the highest commitment it holds.
 *
 *   COGLADIUS_AGENT_SECRET=S... CRON_SECRET=... npx tsx examples/unilateral-close-demo.ts --api URL
 *
 * 1. open a small session and pay 3 requests off-chain
 * 2. the agent calls close_start (as if the provider had gone silent)
 * 3. the provider sweeper (GET /api/mpp/session/sweep) sees the pending close
 *    and closes with its highest commitment, before the refund window opens
 * Result: the provider is paid exactly what was committed; the rest returns to the agent.
 */
import { KeypairSigner, PaymentSession, resolveNetwork, toStroops, fromStroops, explorerTx } from "../src/index.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const net = resolveNetwork("mainnet", { apiBaseUrl: arg("api"), rpcUrl: process.env.SOROBAN_RPC_URL });
const signer = KeypairSigner.fromSecret(process.env.COGLADIUS_AGENT_SECRET!);
const info: any = await fetch(`${net.apiBaseUrl}/api/mpp`).then((r) => r.json());

const session = await PaymentSession.open({
  net: { ...net, channelFactoryId: info.session.channelFactory },
  signer,
  recipient: info.recipient,
  deposit: toStroops("0.05"),
  refundWaitingPeriod: info.session.minRefundWaitingPeriodLedgers,
});
console.log("opened", session.channel, explorerTx(net, session.record.openTxHash));

for (let i = 0; i < 3; i++) {
  const r = await session.fetch(`${net.apiBaseUrl}/api/mpp/session/network-metrics`);
  if (!r.response.ok) throw new Error(`payment ${i + 1} failed: ${r.response.status}`);
}
console.log("committed off-chain:", fromStroops(session.record.signed), "XLM");

const start = await session.startClose();
console.log("agent close_start", explorerTx(net, start.hash), "refundable at ledger", start.refundableAtLedger);

const sweep: any = await fetch(`${net.apiBaseUrl}/api/mpp/session/sweep`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
}).then((r) => r.json());
const mine = sweep.results?.find((x: any) => x.channel === session.channel);
console.log("provider sweeper:", mine);
if (mine?.hash) console.log("provider close", explorerTx(net, mine.hash));
console.log("channel state after", await session.state());

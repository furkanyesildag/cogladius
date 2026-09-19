/**
 * Soak test for both MPP modes against a live provider: N charge payments,
 * then one session with M commitments and a close. Reports every failure, so
 * intermittent RPC problems (such as the CAP-71 credential decode issue) show
 * up as a number rather than an anecdote.
 *
 *   COGLADIUS_AGENT_SECRET=S... npx tsx examples/mpp-stress.ts --api URL [--charges 10] [--commitments 40]
 */
import { KeypairSigner, PaymentSession, createChargePayer, resolveNetwork, toStroops, fromStroops, explorerTx } from "../src/index.js";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const net = resolveNetwork("mainnet", { apiBaseUrl: arg("api", "https://www.cogladius.xyz"), rpcUrl: process.env.SOROBAN_RPC_URL });
const signer = KeypairSigner.fromSecret(process.env.COGLADIUS_AGENT_SECRET!);
const info: any = await fetch(`${net.apiBaseUrl}/api/mpp`).then((r) => r.json());

const failures: string[] = [];
const charge = createChargePayer({ net, signer });
const chargeTxs: string[] = [];
const nCharges = Number(arg("charges", "10"));
for (let i = 0; i < nCharges; i++) {
  try {
    const r = await charge.fetch(`${net.apiBaseUrl}/api/mpp/charge/network-metrics`);
    if (!r.response.ok) failures.push(`charge ${i + 1}: HTTP ${r.response.status} ${await r.response.text()}`);
    else if (r.receipt?.reference) chargeTxs.push(r.receipt.reference);
  } catch (e: any) {
    failures.push(`charge ${i + 1}: ${e.message}`);
  }
}

const nCommit = Number(arg("commitments", "40"));
const session = await PaymentSession.open({
  net: { ...net, channelFactoryId: info.session.channelFactory },
  signer,
  recipient: info.recipient,
  deposit: toStroops("0.05"),
  refundWaitingPeriod: info.session.minRefundWaitingPeriodLedgers,
});
let accepted = 0;
for (let i = 0; i < nCommit; i++) {
  try {
    const r = await session.fetch(`${net.apiBaseUrl}/api/mpp/session/${i % 2 ? "escrow-config" : "network-metrics"}`);
    if (r.response.ok) accepted++;
    else failures.push(`commitment ${i + 1}: HTTP ${r.response.status} ${await r.response.text()}`);
  } catch (e: any) {
    failures.push(`commitment ${i + 1}: ${e.message}`);
  }
}
const closed = await session.requestClose();

console.log(
  JSON.stringify(
    {
      charges: { attempted: nCharges, settled: chargeTxs.length, txs: chargeTxs.map((h) => explorerTx(net, h)) },
      session: {
        channel: session.channel,
        open: explorerTx(net, session.record.openTxHash),
        commitmentsAttempted: nCommit,
        commitmentsAccepted: accepted,
        signed: fromStroops(session.record.signed),
        settled: closed.amount,
        close: explorerTx(net, closed.hash),
      },
      failures,
    },
    null,
    2
  )
);

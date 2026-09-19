/**
 * Close an MPP session opened earlier (state is read from COGLADIUS_STATE_DIR).
 *
 *   COGLADIUS_AGENT_SECRET=S... npx tsx examples/close-session.ts --channel C... [--api URL]
 *       ask the provider to close with its highest commitment (normal path)
 *   ... --force-start      provider unresponsive: start the unilateral close
 *   ... --refund           after the waiting period: take the remaining balance back
 */
import { KeypairSigner, PaymentSession, resolveNetwork, explorerTx, fromStroops } from "../src/index.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const net = resolveNetwork("mainnet", { apiBaseUrl: arg("api"), rpcUrl: process.env.SOROBAN_RPC_URL });
const signer = KeypairSigner.fromSecret(process.env.COGLADIUS_AGENT_SECRET!);
const s = await PaymentSession.resume({ net, signer, channel: arg("channel")! });
console.log("before", (await s.state()));
if (process.argv.includes("--force-start")) {
  const r = await s.startClose();
  console.log({ closeStart: explorerTx(net, r.hash), refundableAtLedger: r.refundableAtLedger });
} else if (process.argv.includes("--refund")) {
  const r = await s.refund();
  console.log({ refund: explorerTx(net, r.hash) });
} else {
  const r = await s.requestClose();
  console.log({ settled: `${r.amount} XLM`, close: explorerTx(net, r.hash), committedBySession: fromStroops(s.record.signed) });
}
console.log("after", await s.state());

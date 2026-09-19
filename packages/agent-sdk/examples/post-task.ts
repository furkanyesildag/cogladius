/**
 * Post a task with its reward locked in the Cogladius escrow.
 *
 *   COGLADIUS_POSTER_SECRET=S... npx tsx examples/post-task.ts \
 *     --reward 0.5 --minutes 10 [--sponsored] [--api https://www.cogladius.xyz] \
 *     --description "..." --criteria "..."
 *
 * --sponsored: the poster signs only the post_task authorization entry and a
 * relayer pays the network fee. The script prints the poster's balance before
 * and after, which differs by exactly the reward.
 */
import { KeypairSigner, EscrowClient, resolveNetwork, toStroops, fromStroops, explorerTx, postTaskSponsored } from "../src/index.js";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const secret = process.env.COGLADIUS_POSTER_SECRET;
if (!secret) throw new Error("set COGLADIUS_POSTER_SECRET");

const net = resolveNetwork("mainnet", { apiBaseUrl: arg("api"), rpcUrl: process.env.SOROBAN_RPC_URL });
const poster = KeypairSigner.fromSecret(secret);
const escrow = new EscrowClient(net);
const reward = toStroops(arg("reward", "0.5")!);
const minutes = Number(arg("minutes", "10"));
const deadline = Math.floor(Date.now() / 1000) + minutes * 60;
const taskId = await escrow.freeTaskId();

async function balance(): Promise<bigint> {
  const a: any = await fetch(`${net.horizonUrl}/accounts/${poster.publicKey}`).then((r) => r.json());
  return toStroops(a.balances.find((b: any) => b.asset_type === "native").balance);
}

const before = await balance();
const sponsored = process.argv.includes("--sponsored");
const res = sponsored
  ? await postTaskSponsored({ net, poster, taskId, reward, deadline })
  : await escrow.postTask(poster, { taskId, reward, deadline });
// Horizon ingests a few seconds behind RPC: wait until it has the tx before reading the balance.
for (let i = 0; i < 30; i++) {
  if ((await fetch(`${net.horizonUrl}/transactions/${res.hash}`)).ok) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const after = await balance();

const record = await fetch(`${net.apiBaseUrl}/api/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    poster: poster.publicKey,
    description: arg("description", "Summarise the current Stellar network fee conditions and the XLM/USDC order book, and say whether now is a cheap time to submit Soroban transactions."),
    criteria: arg("criteria", "Uses live data, cites concrete numbers (ledger, fees, prices), gives a clear recommendation."),
    contractTaskId: Number(taskId),
    postTxHash: res.hash,
    taskType: "research",
    outputFormat: "report",
  }),
}).then((r) => r.json());

console.log(JSON.stringify({
  taskId: record.task?.id,
  contractTaskId: taskId.toString(),
  reward: fromStroops(reward),
  deadline: new Date(deadline * 1000).toISOString(),
  sponsored,
  postTx: explorerTx(net, res.hash),
  posterBalanceBefore: fromStroops(before),
  posterBalanceAfter: fromStroops(after),
  posterPaid: fromStroops(before - after),
  feePaidByPoster: fromStroops(before - after - reward),
  feePayer: sponsored ? (res as any).relayer : poster.publicKey,
  recordError: record.success ? undefined : record.error,
}, null, 2));

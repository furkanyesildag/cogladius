/**
 * After importing a real export: does the app read it? Prints counts and
 * true/false only. Run with the same env as the app:
 *   node --import tsx --import ./tests/pg/fetch-guard.mjs tests/pg/verify-real-import.mjs
 * (without fetch-guard against real Neon).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const registry = await import("../../lib/agentRegistry.ts");
const { getAllTasks } = await import("../../lib/taskStore.ts");
const { getAllProjects } = await import("../../lib/projectStore.ts");
const { getAllApplications } = await import("../../lib/applicationStore.ts");
const { statsRead } = await import("../../lib/arena.ts");
const { setMembers } = await import("../../lib/mpp/store.ts");

const SAMPLE = 200;
const rows = await sql.query(`SELECT value FROM kv_hashes WHERE key = 'cogladius:agents:v2' ORDER BY random() LIMIT ${SAMPLE}`);
let resolved = 0;
let approved = 0;
for (const { value } of rows) {
  const stored = JSON.parse(value);
  const agent = await registry.getAgentByApiKey(stored.apiKey);
  if (agent?.pubkey === stored.pubkey) resolved++;
  if (await registry.validateApiKey(stored.apiKey)) approved++;
}
console.log(`sample api keys resolved through getAgentByApiKey: ${resolved === rows.length} (${resolved}/${rows.length})`);
console.log(`of those, accepted by validateApiKey: ${approved}/${rows.length}`);
console.log(`unknown key resolves: ${(await registry.getAgentByApiKey("claw_not_a_real_key")) !== null}`);

let t = Date.now();
const all = await registry.getAllAgents();
console.log(`getAllAgents: ${all.length} agents in ${Date.now() - t} ms`);

let walked = 0;
let cursor = "0";
let total = 0;
do {
  const page = await registry.getApprovedAgentsPage(200, cursor);
  walked += page.agents.length;
  total = page.total;
  cursor = page.nextCursor ?? "0";
} while (cursor !== "0");
console.log(`getApprovedAgentsPage walk: ${walked} approved of ${total} total`);

const [{ n: indexed }] = await sql.query(`SELECT count(*)::int AS n FROM kv_hashes WHERE key = 'cogladius:agent-key-index'`);
console.log(`key index entries: ${indexed}`);
console.log(`tasks: ${(await getAllTasks()).length}, projects: ${(await getAllProjects()).length}, applications: ${(await getAllApplications()).length}`);
const stats = await statsRead();
console.log(`arena stats present: ${stats.attempts > 0}`);
console.log(`mpp channels: ${(await setMembers("cogladius:mpp:channels")).length}`);

#!/usr/bin/env node
/**
 * Load a Redis export into Postgres (the tables behind lib/pgRedis.ts).
 *
 *   DATABASE_URL=... node scripts/import-redis-export.mjs <export.json> [--dry-run] [--exported-at <ms>]
 *   DATABASE_URL=... node scripts/import-redis-export.mjs <final.json> --baseline <first.json>
 *
 * Export shape: { key: { type: "string"|"hash"|"set"|"none", ttl: seconds|-1|-2, value } }.
 *
 * Full import: upserts everything, so re-running gives the same result. Run it
 * only BEFORE the app writes to Postgres: it overwrites what is there.
 *
 * Delta (--baseline): for the writes Upstash took after the first export. A
 * three-way merge of baseline, final export and current Postgres, safe while the
 * app is live on Postgres. See mergeString/mergeField for the rules. A given
 * pair of files applies once: counters are added, so a re-run is refused.
 *
 * TTLs count from the export time, taken from the file name, so time spent since
 * then is not granted again. Output is counts per key family only: never a value,
 * a full key name or the connection string.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Key classification ───────────────────────────────────────────────────────

/** Short-lived guards and caches. Starting them fresh is harmless. */
const SKIP = [/^arena:rate:/, /^arena:attempt-lock:/, /^arena:minted-cache$/, /^cogladius:register-rate:/, /^cogladius:challenge-rate:/];

const FAMILIES = [
  [/^arena:rate:/, "arena:rate:*"],
  [/^arena:attempt-lock:/, "arena:attempt-lock:*"],
  [/^arena:attempt:/, "arena:attempt:*"],
  [/^arena:attempts:/, "arena:attempts:*"],
  [/^arena:result:/, "arena:result:*"],
  [/^arena:agent-wallet:/, "arena:agent-wallet:*"],
  [/^arena:verified-wallet:/, "arena:verified-wallet:*"],
  [/^arena:verified-agent:/, "arena:verified-agent:*"],
  [/^arena:link-nonce:/, "arena:link-nonce:*"],
  [/^cogladius:challenge-rate:/, "cogladius:challenge-rate:*"],
  [/^cogladius:challenge:/, "cogladius:challenge:*"],
  [/^cogladius:register-rate:/, "cogladius:register-rate:*"],
  [/^cogladius:relay:poster:/, "cogladius:relay:poster:*"],
  [/^cogladius:mppx:/, "cogladius:mppx:*"],
  [/^cogladius:mpp:ledger:/, "cogladius:mpp:ledger:*"],
];
const SINGLE_KEYS = new Set([
  "arena:stats", "arena:minted-cache", "cogladius:agents", "cogladius:agents:v2", "cogladius:agent-key-index", "cogladius:applications",
  "cogladius:projects", "cogladius:tasks", "cogladius:reputation:raw-events", "cogladius:relay:budget", "cogladius:mpp:channels",
]);

/** Never echoes a key it does not know: those can embed identifiers. */
function familyOf(key) {
  if (SINGLE_KEYS.has(key)) return key;
  for (const [re, label] of FAMILIES) if (re.test(key)) return label;
  const head = key.split(":")[0];
  return /^[a-z-]{1,20}$/.test(head) ? `other:${head}:*` : "other:?";
}

/** JSON objects keyed by record id, written whole by the app. Delta merges them per record. */
const RECORD_BLOBS = new Set(["cogladius:tasks", "cogladius:projects", "cogladius:applications"]);
/** Rebuilt from chain by the app, so a delta does not need to carry it. */
const DERIVED = new Set(["cogladius:reputation:raw-events"]);

// ── Export parsing ───────────────────────────────────────────────────────────

/** Same rule as the Upstash client: strings stay, the rest is JSON. Values may have been deserialized on export. */
function stored(v) {
  if (typeof v === "string") return v.toWellFormed();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v).toWellFormed();
}

function hashEntries(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i + 1 < value.length; i += 2) out.push([String(value[i]).toWellFormed(), stored(value[i + 1])]);
    return out;
  }
  return Object.entries(value ?? {}).map(([f, v]) => [f.toWellFormed(), stored(v)]);
}

function exportTime(path, override) {
  if (override) return Number(override);
  const m = /-(\d{13})\.json$/.exec(path);
  return m ? Number(m[1]) : statSync(path).mtimeMs;
}

const hasNul = (s) => s.includes("\0");

function load(path, exportedAt) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const rows = { strings: [], hashes: [], sets: [] };
  const families = new Map();
  const fam = (key) => {
    const label = familyOf(key);
    if (!families.has(label)) {
      families.set(label, { family: label, keys: 0, imported: 0, fields: 0, bytes: 0, skipShortLived: 0, skipExpired: 0, skipNone: 0, skipUnsupported: 0, hashTtlDropped: 0 });
    }
    return families.get(label);
  };
  const now = Date.now();
  const shapes = {};
  for (const [key, rec] of Object.entries(raw)) {
    const f = fam(key);
    f.keys++;
    const shape = `${rec?.type}/${Array.isArray(rec?.value) ? "array" : typeof rec?.value}/ttl:${rec?.ttl > 0 ? "positive" : rec?.ttl}`;
    shapes[shape] = (shapes[shape] ?? 0) + 1;
    if (rec?.type === "none") { f.skipNone++; continue; }
    if (rec?.ttl === -2) { f.skipExpired++; continue; }
    if (SKIP.some((re) => re.test(key))) { f.skipShortLived++; continue; }
    const expiresAtMs = typeof rec.ttl === "number" && rec.ttl > 0 ? exportedAt + rec.ttl * 1000 : null;
    if (expiresAtMs !== null && expiresAtMs <= now) { f.skipExpired++; continue; }
    if (rec.type === "string") {
      if (rec.value === null || rec.value === undefined) { f.skipNone++; continue; }
      const value = stored(rec.value);
      if (hasNul(key) || hasNul(value)) { f.skipUnsupported++; continue; }
      rows.strings.push({ key, value, expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString() });
      f.bytes += value.length;
    } else if (rec.type === "hash") {
      if (expiresAtMs !== null) f.hashTtlDropped++;
      for (const [field, value] of hashEntries(rec.value)) {
        if (hasNul(key) || hasNul(field) || hasNul(value)) { f.skipUnsupported++; continue; }
        rows.hashes.push({ key, field, value });
        f.fields++;
        f.bytes += field.length + value.length;
      }
    } else if (rec.type === "set") {
      for (const m of rec.value ?? []) {
        const member = stored(m);
        if (hasNul(key) || hasNul(member)) { f.skipUnsupported++; continue; }
        rows.sets.push({ key, member });
        f.fields++;
        f.bytes += member.length;
      }
    } else {
      f.skipUnsupported++;
      continue;
    }
    f.imported++;
  }
  return { rows, families, shapes };
}

// ── Database ─────────────────────────────────────────────────────────────────

const pgArgs = (rows, cols) => cols.map((c) => rows.map((r) => r[c]));

/** Splits rows into requests small enough for Neon's HTTP limit (64 MB), far below it. */
function* chunks(rows, sizeOf, maxBytes = 4 * 1024 * 1024, maxRows = 2000) {
  let cur = [];
  let bytes = 0;
  for (const row of rows) {
    const size = sizeOf(row);
    if (cur.length && (bytes + size > maxBytes || cur.length >= maxRows)) {
      yield cur;
      cur = [];
      bytes = 0;
    }
    cur.push(row);
    bytes += size;
  }
  if (cur.length) yield cur;
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
    }
  }
}

async function applySchema(sql) {
  const text = readFileSync(join(HERE, "redis-pg-schema.sql"), "utf8").replace(/^--.*$/gm, "");
  for (const stmt of text.split(";").map((s) => s.trim()).filter(Boolean)) await withRetry(() => sql.query(stmt));
}

async function fullImport(sql, rows) {
  for (const c of chunks(rows.strings, (r) => r.key.length + r.value.length)) {
    await withRetry(() =>
      sql.query(
        `INSERT INTO kv_strings (key, value, expires_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[])
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
        pgArgs(c, ["key", "value", "expiresAt"])
      )
    );
  }
  for (const c of chunks(rows.hashes, (r) => r.key.length + r.field.length + r.value.length)) {
    await withRetry(() =>
      sql.query(
        `INSERT INTO kv_hashes (key, field, value)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value`,
        pgArgs(c, ["key", "field", "value"])
      )
    );
  }
  for (const c of chunks(rows.sets, (r) => r.key.length + r.member.length)) {
    await withRetry(() =>
      sql.query(
        `INSERT INTO kv_sets (key, member) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`,
        pgArgs(c, ["key", "member"])
      )
    );
  }
}

const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");

/** Compares what is stored with what was meant to be, by count and md5. Rows expiring meanwhile are not faults. */
async function verify(sql, rows, families) {
  const live = "(expires_at IS NULL OR expires_at > now())";
  const inDb = {
    strings: new Map((await withRetry(() => sql.query(`SELECT key, md5(value) AS h FROM kv_strings WHERE ${live}`))).map((r) => [r.key, r.h])),
    hashes: new Map((await withRetry(() => sql.query("SELECT key, field, md5(value) AS h FROM kv_hashes"))).map((r) => [`${r.key}\0${r.field}`, r.h])),
    sets: new Set((await withRetry(() => sql.query("SELECT key, member FROM kv_sets"))).map((r) => `${r.key}\0${r.member}`)),
  };
  const result = new Map([...families.keys()].map((k) => [k, { expected: 0, found: 0, differs: 0 }]));
  const graceMs = Date.now() + 60_000;
  const tally = (key, state) => {
    const t = result.get(familyOf(key));
    t.expected++;
    if (state !== "missing") t.found++;
    if (state === "differs") t.differs++;
  };
  for (const r of rows.strings) {
    if (r.expiresAt && Date.parse(r.expiresAt) < graceMs) continue;
    const h = inDb.strings.get(r.key);
    tally(r.key, h === undefined ? "missing" : h === md5(r.value) ? "same" : "differs");
  }
  for (const r of rows.hashes) {
    const h = inDb.hashes.get(`${r.key}\0${r.field}`);
    tally(r.key, h === undefined ? "missing" : h === md5(r.value) ? "same" : "differs");
  }
  for (const r of rows.sets) tally(r.key, inDb.sets.has(`${r.key}\0${r.member}`) ? "same" : "missing");
  return result;
}

// ── Delta: three-way merge ───────────────────────────────────────────────────

const INT = /^-?\d{1,18}$/;

/**
 * For each string the export changed since the baseline:
 *  - integer on both sides: a counter, so add the difference to whatever Postgres holds.
 *  - a record blob: merge per record id.
 *  - anything else: write only if Postgres still holds the baseline value.
 * Postgres having moved on as well is a conflict: Postgres wins and it is counted.
 */
async function mergeString(sql, key, base, final, tally) {
  const expires = final?.expiresAt ?? null;
  if (final && INT.test(final.value) && (base === undefined || INT.test(base.value))) {
    const diff = BigInt(final.value) - BigInt(base?.value ?? 0);
    await withRetry(() =>
      sql.query(
        `INSERT INTO kv_strings (key, value, expires_at) VALUES ($1, $2, $3::timestamptz)
         ON CONFLICT (key) DO UPDATE SET
           value = CASE WHEN kv_strings.expires_at <= now() THEN EXCLUDED.value ELSE (kv_strings.value::bigint + $4::bigint)::text END,
           expires_at = CASE WHEN kv_strings.expires_at <= now() THEN EXCLUDED.expires_at ELSE kv_strings.expires_at END`,
        [key, final.value, expires, diff.toString()]
      )
    );
    tally.applied++;
    return;
  }
  if (RECORD_BLOBS.has(key) && final) return mergeBlob(sql, key, base, final, tally);
  const baseValue = base?.value ?? null;
  const live = "(kv_strings.expires_at IS NULL OR kv_strings.expires_at > now())";
  let rows;
  if (!final) {
    rows = await withRetry(() => sql.query(`DELETE FROM kv_strings WHERE key = $1 AND value = $2 RETURNING 1 AS ok`, [key, baseValue]));
    // Already gone from Postgres is the same outcome as deleting it, not a conflict.
    if (!rows.length && (await sql.query(`SELECT 1 AS ok FROM kv_strings WHERE key = $1 AND ${live}`, [key])).length === 0) rows = [1];
  } else if (baseValue === null) {
    rows = await withRetry(() =>
      sql.query(
        `INSERT INTO kv_strings (key, value, expires_at) VALUES ($1, $2, $3::timestamptz)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
         WHERE kv_strings.expires_at <= now() RETURNING 1 AS ok`,
        [key, final.value, expires]
      )
    );
  } else {
    rows = await withRetry(() =>
      sql.query(`UPDATE kv_strings SET value = $2, expires_at = $3::timestamptz WHERE key = $1 AND value = $4 RETURNING 1 AS ok`, [key, final.value, expires, baseValue])
    );
  }
  if (rows.length) tally.applied++;
  else tally.conflicts++;
}

async function mergeBlob(sql, key, base, final, tally) {
  const b = JSON.parse(base?.value ?? "{}");
  const f = JSON.parse(final.value);
  const ids = [...new Set([...Object.keys(b), ...Object.keys(f)])].filter((id) => JSON.stringify(b[id]) !== JSON.stringify(f[id]));
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = await withRetry(() => sql.query("SELECT value FROM kv_strings WHERE key = $1", [key]));
    const curRaw = rows[0]?.value ?? null;
    const cur = JSON.parse(curRaw ?? "{}");
    let applied = 0;
    const conflictIds = [];
    for (const id of ids) {
      if (JSON.stringify(cur[id]) !== JSON.stringify(b[id])) {
        conflictIds.push(id);
        continue;
      }
      if (f[id] === undefined) delete cur[id];
      else cur[id] = f[id];
      applied++;
    }
    const next = JSON.stringify(cur);
    const written = applied === 0
      ? [1]
      : curRaw === null
        ? await withRetry(() => sql.query(`INSERT INTO kv_strings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING 1 AS ok`, [key, next]))
        : await withRetry(() => sql.query(`UPDATE kv_strings SET value = $2 WHERE key = $1 AND value = $3 RETURNING 1 AS ok`, [key, next, curRaw]));
    if (written.length) {
      tally.applied += applied;
      tally.conflicts += conflictIds.length;
      // Record ids (task and project numbers, application ids) are not secret, and these need a human look.
      if (conflictIds.length) tally.conflictIds.push(...conflictIds);
      return;
    }
  }
  throw new Error("record blob kept changing during the merge");
}

async function mergeField(sql, key, field, base, final, tally) {
  if (final !== undefined && INT.test(final) && (base === undefined || INT.test(base))) {
    const diff = BigInt(final) - BigInt(base ?? 0);
    await withRetry(() =>
      sql.query(
        `INSERT INTO kv_hashes (key, field, value) VALUES ($1, $2, $3)
         ON CONFLICT (key, field) DO UPDATE SET value = (kv_hashes.value::bigint + $4::bigint)::text`,
        [key, field, final, diff.toString()]
      )
    );
    tally.applied++;
    return;
  }
  let rows;
  if (final === undefined) {
    rows = await withRetry(() => sql.query(`DELETE FROM kv_hashes WHERE key = $1 AND field = $2 AND value = $3 RETURNING 1 AS ok`, [key, field, base]));
  } else if (base === undefined) {
    rows = await withRetry(() => sql.query(`INSERT INTO kv_hashes (key, field, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1 AS ok`, [key, field, final]));
  } else {
    rows = await withRetry(() => sql.query(`UPDATE kv_hashes SET value = $4 WHERE key = $1 AND field = $2 AND value = $3 RETURNING 1 AS ok`, [key, field, base, final]));
  }
  if (rows.length) tally.applied++;
  else tally.conflicts++;
}

async function deltaImport(sql, baseRows, finalRows) {
  const tallies = new Map();
  const tallyFor = (key) => {
    const label = familyOf(key);
    if (!tallies.has(label)) tallies.set(label, { family: label, changed: 0, applied: 0, conflicts: 0, skippedDerived: 0, conflictIds: [] });
    return tallies.get(label);
  };
  const tasks = [];

  const baseStrings = new Map(baseRows.strings.map((r) => [r.key, r]));
  const finalStrings = new Map(finalRows.strings.map((r) => [r.key, r]));
  for (const key of new Set([...baseStrings.keys(), ...finalStrings.keys()])) {
    const b = baseStrings.get(key);
    const f = finalStrings.get(key);
    if (b?.value === f?.value) continue;
    const t = tallyFor(key);
    t.changed++;
    if (DERIVED.has(key)) { t.skippedDerived++; continue; }
    tasks.push(() => mergeString(sql, key, b, f, t));
  }

  const fieldId = (r) => `${r.key}\0${r.field}`;
  const baseFields = new Map(baseRows.hashes.map((r) => [fieldId(r), r]));
  const finalFields = new Map(finalRows.hashes.map((r) => [fieldId(r), r]));
  for (const id of new Set([...baseFields.keys(), ...finalFields.keys()])) {
    const b = baseFields.get(id);
    const f = finalFields.get(id);
    if (b?.value === f?.value) continue;
    const { key, field } = b ?? f;
    const t = tallyFor(key);
    t.changed++;
    tasks.push(() => mergeField(sql, key, field, b?.value, f?.value, t));
  }

  const baseMembers = new Set(baseRows.sets.map((r) => `${r.key}\0${r.member}`));
  for (const r of finalRows.sets) {
    if (baseMembers.has(`${r.key}\0${r.member}`)) continue;
    const t = tallyFor(r.key);
    t.changed++;
    tasks.push(async () => {
      await withRetry(() => sql.query("INSERT INTO kv_sets (key, member) VALUES ($1, $2) ON CONFLICT DO NOTHING", [r.key, r.member]));
      t.applied++;
    });
  }

  for (let i = 0; i < tasks.length; i += 16) await Promise.all(tasks.slice(i, i + 16).map((run) => run()));
  return [...tallies.values()].sort((a, b) => a.family.localeCompare(b.family));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { path: null, dryRun: false, baseline: null, exportedAt: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--baseline") out.baseline = argv[++i];
    else if (argv[i] === "--exported-at") out.exportedAt = argv[++i];
    else if (!out.path && !argv[i].startsWith("--")) out.path = argv[i];
    else throw new Error(`unknown argument ${argv[i].startsWith("--") ? argv[i] : "(path)"}`);
  }
  if (!out.path) throw new Error("usage: import-redis-export.mjs <export.json> [--dry-run] [--exported-at <ms>] [--baseline <first-export.json>]");
  return out;
}

function targetHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable)";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rows, families, shapes } = load(args.path, exportTime(args.path, args.exportedAt));
  const report = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
  console.log(`rows to write: strings=${rows.strings.length} hashFields=${rows.hashes.length} setMembers=${rows.sets.length}`);
  console.table(report);
  console.log(`export shapes (type/value type/ttl): ${JSON.stringify(shapes)}`);

  if (args.dryRun) return;

  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  console.log(`target host: ${targetHost(url)}`);
  // Neon's HTTP driver for Neon, a TCP connection for any other Postgres. Both return rows as objects.
  const pg = /\.neon\.tech[:/]/.test(url) ? null : postgres(url, { prepare: false, max: 1 });
  const sql = pg ? { query: (text, params = []) => pg.unsafe(text, params) } : neon(url);
  await applySchema(sql);

  if (args.baseline) {
    const id = createHash("sha256").update(readFileSync(args.baseline)).update(readFileSync(args.path)).digest("hex");
    await withRetry(() => sql.query("CREATE TABLE IF NOT EXISTS kv_import_log (id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), done boolean NOT NULL DEFAULT false)"));
    const fresh = await withRetry(() => sql.query("INSERT INTO kv_import_log (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [id]));
    if (!fresh.length) {
      const [{ done }] = await withRetry(() => sql.query("SELECT done FROM kv_import_log WHERE id = $1", [id]));
      if (done) {
        console.log("delta: this pair of exports was already applied, nothing done");
        return;
      }
      throw new Error("an earlier run of this delta stopped partway; counters may hold part of it, so it will not run again");
    }
    const base = load(args.baseline, exportTime(args.baseline, null));
    const tallies = await deltaImport(sql, base.rows, rows);
    console.table(tallies.map(({ conflictIds, ...t }) => t));
    for (const t of tallies) if (t.conflictIds.length) console.log(`conflicts kept as in Postgres, ${t.family}: ${t.conflictIds.join(",")}`);
    console.log(`delta: changed=${tallies.reduce((a, t) => a + t.changed, 0)} applied=${tallies.reduce((a, t) => a + t.applied, 0)} conflicts=${tallies.reduce((a, t) => a + t.conflicts, 0)}`);
    await withRetry(() => sql.query("UPDATE kv_import_log SET done = true WHERE id = $1", [id]));
    return;
  }

  await fullImport(sql, rows);
  const checks = await verify(sql, rows, families);
  console.table([...checks].map(([family, c]) => ({ family, ...c })));
  const bad = [...checks.values()].filter((c) => c.found !== c.expected || c.differs > 0).length;
  const dbCounts = await withRetry(() =>
    sql.query(`SELECT (SELECT count(*) FROM kv_strings)::int AS strings, (SELECT count(*) FROM kv_hashes)::int AS "hashFields", (SELECT count(*) FROM kv_sets)::int AS "setMembers"`)
  );
  console.log(`database totals: ${JSON.stringify(dbCounts[0])}`);
  if (bad) {
    console.error(`VERIFY FAILED in ${bad} families`);
    process.exitCode = 1;
  } else {
    console.log("verify ok: every expected row is present with the same md5");
  }
}

main().then(() => process.exit()).catch((err) => {
  // SQL errors can quote parameters, so those print the code alone.
  const detail = err?.code ? "" : ` (${String(err?.message).slice(0, 120).replace(/postgres(ql)?:\/\/\S+/g, "<url>")})`;
  console.error(`import failed: ${err?.code ?? err?.name ?? "error"}${detail}`);
  process.exit(1);
});

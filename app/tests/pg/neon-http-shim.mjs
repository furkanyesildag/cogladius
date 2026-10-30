/**
 * Local stand-in for Neon's HTTP SQL endpoint, so tests run the real
 * @neondatabase/serverless driver. Backend: real Postgres when TEST_DATABASE_URL
 * is set (needed for true concurrency: set PG_MODULE_FROM to a folder holding the
 * `pg` package), otherwise in-memory PGlite, which runs one query at a time.
 *
 * Standalone: node tests/pg/neon-http-shim.mjs <port>
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function toWire(result) {
  return {
    command: result.command ?? "",
    rowCount: result.rowCount ?? result.rows.length,
    rows: result.rows.map((row) => row.map((v) => (v === null ? null : String(v)))),
    fields: (result.fields ?? []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowAsArray: true,
  };
}

async function pgBackend(url) {
  const require = createRequire(`${process.env.PG_MODULE_FROM}/`);
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url, max: 40 });
  const asText = { getTypeParser: () => (v) => v };
  const run = (client, q) => client.query({ text: q.query, values: q.params, rowMode: "array", types: asText });
  return {
    kind: "postgres",
    query: async (q) => toWire(await run(pool, q)),
    batch: async (queries, isolation) => {
      const client = await pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        const out = [];
        for (const q of queries) out.push(toWire(await run(client, q)));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteBackend() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  // The driver has already encoded parameters as Postgres text, arrays included.
  const passThrough = Object.fromEntries([16, 20, 21, 23, 25, 701, 1009, 1184, 1185, 1016, 1007].map((oid) => [oid, (v) => v]));
  const opts = { rowMode: "array", serializers: passThrough };
  return {
    kind: "pglite",
    query: async (q) => toWire(await db.query(q.query, q.params, opts)),
    batch: (queries) =>
      db.transaction(async (tx) => {
        const out = [];
        for (const q of queries) out.push(toWire(await tx.query(q.query, q.params, opts)));
        return out;
      }),
    close: () => db.close(),
  };
}

export async function startShim() {
  const backend = process.env.TEST_DATABASE_URL ? await pgBackend(process.env.TEST_DATABASE_URL) : await pgliteBackend();
  const stats = { requests: 0, failNext: 0, failStatus: 503 };
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      stats.requests++;
      res.setHeader("content-type", "application/json");
      if (stats.failNext > 0) {
        stats.failNext--;
        res.statusCode = stats.failStatus;
        return res.end(JSON.stringify({ message: "shim: injected failure" }));
      }
      try {
        const parsed = JSON.parse(body);
        const isolation = String(req.headers["neon-batch-isolation-level"] ?? "ReadCommitted").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
        const out = parsed.queries ? { results: await backend.batch(parsed.queries, isolation) } : await backend.query(parsed);
        res.end(JSON.stringify(out));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: String(err.message), code: err.code }));
      }
    });
  });
  await new Promise((resolve) => server.listen(Number(process.argv[2]) || 0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    kind: backend.kind,
    stats,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await backend.close();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shim = await startShim();
  console.log(`neon shim on ${shim.url} backend=${shim.kind} pid=${process.pid}`);
}

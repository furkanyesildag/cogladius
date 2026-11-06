/**
 * The subset of the @upstash/redis API this app uses, on Postgres (Neon or any other).
 *
 * Every command is a single SQL statement, so it is atomic on its own. On Neon
 * it goes over the HTTP driver: one stateless fetch, no pool to hold open; any
 * other Postgres gets one TCP connection per instance. pipeline()/multi() send
 * their statements as one transaction. Return shapes and JSON deserialization match @upstash/redis.
 *
 * Expiry is lazy: reads filter on expires_at, and a small share of TTL writes
 * also delete a batch of expired rows. TTLs exist on strings only, which is all
 * the app sets them on.
 *
 * Tables: scripts/redis-pg-schema.sql.
 */

// ── @upstash/redis (de)serialization, same rules as the client ───────────────

function parseRecursive(obj: any): any {
  const parsed = Array.isArray(obj)
    ? obj.map((o) => {
        try {
          return parseRecursive(o);
        } catch {
          return o;
        }
      })
    : JSON.parse(obj);
  if (typeof parsed === "number" && parsed.toString() !== obj) return obj;
  return parsed;
}

function parseResponse(result: any): any {
  try {
    return parseRecursive(result);
  } catch {
    return result;
  }
}

function parseHash(flat: string[]): Record<string, unknown> | null {
  if (flat.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (let i = 0; i < flat.length; i += 2) {
    const value = flat[i + 1];
    try {
      const unsafeNumber = !Number.isNaN(Number(value)) && !Number.isSafeInteger(Number(value));
      out[flat[i]] = unsafeNumber ? value : JSON.parse(value);
    } catch {
      out[flat[i]] = value;
    }
  }
  return out;
}

function serialize(v: unknown): string {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

/** Postgres text cannot hold NUL or lone surrogates. No stored key has them, so such a lookup simply misses. */
function name(s: string): string {
  return String(s).toWellFormed().replace(/\0/g, "�");
}

// ── Cursors: HSCAN pages by the last field seen; "0" is both start and end ───

function encodeCursor(field: string): string {
  return `f${Buffer.from(field, "utf8").toString("base64url")}`;
}

/** Anything else, such as a numeric cursor handed out by Redis before the switch, starts over. */
function decodeCursor(cursor: string | number): string | null {
  const c = String(cursor);
  return c.length > 1 && c[0] === "f" ? name(Buffer.from(c.slice(1), "base64url").toString("utf8")) : null;
}

// ── Statements ───────────────────────────────────────────────────────────────

type Rows = any[][];
type Op = { text: string; params: unknown[]; map: (rows: Rows) => unknown; ttlWrite?: boolean };

const LIVE = "(expires_at IS NULL OR expires_at > now())";
const EXPIRED_ROW = "kv_strings.expires_at IS NOT NULL AND kv_strings.expires_at <= now()";

const CLEANUP_SQL = `DELETE FROM kv_strings WHERE key IN (
  SELECT key FROM kv_strings WHERE expires_at <= now() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)`;

function incrOp(key: string, amount: number | string): Op {
  return {
    text: `INSERT INTO kv_strings (key, value) VALUES ($1, ($2::bigint)::text)
      ON CONFLICT (key) DO UPDATE SET
        value = CASE WHEN ${EXPIRED_ROW} THEN ($2::bigint)::text ELSE (kv_strings.value::bigint + $2::bigint)::text END,
        expires_at = CASE WHEN ${EXPIRED_ROW} THEN NULL ELSE kv_strings.expires_at END
      RETURNING value`,
    params: [name(key), String(amount)],
    map: (rows) => Number(rows[0][0]),
  };
}

type SetOptions = { ex?: number; px?: number; nx?: boolean };

function makeBuilders(parse: (v: any) => any, parseHashResult: (flat: string[]) => unknown) {
  return {
    get: (key: string): Op => ({
      text: `SELECT value FROM kv_strings WHERE key = $1 AND ${LIVE}`,
      params: [name(key)],
      map: (rows) => (rows.length ? parse(rows[0][0]) : null),
    }),

    set: (key: string, value: unknown, opts?: SetOptions): Op => {
      const unknownOpt = Object.keys(opts ?? {}).find((o) => !["ex", "px", "nx"].includes(o));
      if (unknownOpt) throw new Error(`pgRedis: SET option ${unknownOpt} is not implemented`);
      const seconds = opts?.ex ?? (opts?.px === undefined ? null : opts.px / 1000);
      if (seconds !== null && !(seconds > 0)) throw new Error("ERR invalid expire time in 'set' command");
      return {
        text: `INSERT INTO kv_strings (key, value, expires_at)
          VALUES ($1, $2, now() + make_interval(secs => $3::double precision))
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
          ${opts?.nx ? `WHERE ${EXPIRED_ROW}` : ""}
          RETURNING 1`,
        params: [name(key), serialize(value), seconds],
        map: (rows) => (rows.length ? "OK" : null),
        ttlWrite: seconds !== null,
      };
    },

    getdel: (key: string): Op => ({
      text: `DELETE FROM kv_strings WHERE key = $1 RETURNING CASE WHEN ${LIVE} THEN value END`,
      params: [name(key)],
      map: (rows) => (rows.length && rows[0][0] !== null ? parse(rows[0][0]) : null),
    }),

    del: (...keys: string[]): Op => {
      if (keys.length === 0) throw new Error("ERR wrong number of arguments for 'del' command");
      return {
        text: `WITH s AS (DELETE FROM kv_strings WHERE key = ANY($1::text[]) RETURNING key, expires_at),
          h AS (DELETE FROM kv_hashes WHERE key = ANY($1::text[]) RETURNING key),
          m AS (DELETE FROM kv_sets WHERE key = ANY($1::text[]) RETURNING key)
          SELECT count(*)::int FROM (
            SELECT key FROM s WHERE ${LIVE} UNION SELECT key FROM h UNION SELECT key FROM m
          ) deleted`,
        params: [keys.map(name)],
        map: (rows) => Number(rows[0][0]),
      };
    },

    incr: (key: string): Op => incrOp(key, 1),
    incrby: (key: string, amount: number): Op => incrOp(key, amount),

    expire: (key: string, seconds: number): Op => ({
      text: `UPDATE kv_strings SET expires_at = now() + make_interval(secs => $2::double precision)
        WHERE key = $1 AND ${LIVE} RETURNING 1`,
      params: [name(key), seconds],
      map: (rows) => (rows.length ? 1 : 0),
      ttlWrite: true,
    }),

    ttl: (key: string): Op => ({
      text: `SELECT CASE WHEN expires_at IS NULL THEN -1 ELSE round(extract(epoch FROM expires_at - now()))::int END
        FROM kv_strings WHERE key = $1 AND ${LIVE}`,
      params: [name(key)],
      map: (rows) => (rows.length ? Number(rows[0][0]) : -2),
    }),

    hget: (key: string, field: string): Op => ({
      text: "SELECT value FROM kv_hashes WHERE key = $1 AND field = $2",
      params: [name(key), name(field)],
      map: (rows) => (rows.length ? parse(rows[0][0]) : null),
    }),

    hset: (key: string, kv: Record<string, unknown>): Op => {
      const entries = Object.entries(kv);
      if (entries.length === 0) throw new Error("ERR wrong number of arguments for 'hset' command");
      return {
        text: `WITH up AS (
            INSERT INTO kv_hashes (key, field, value)
            SELECT $1, f, v FROM unnest($2::text[], $3::text[]) AS t(f, v)
            ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value
            RETURNING (xmax = 0) AS inserted
          ) SELECT count(*) FILTER (WHERE inserted)::int FROM up`,
        params: [name(key), entries.map(([f]) => name(f)), entries.map(([, v]) => serialize(v))],
        map: (rows) => Number(rows[0][0]),
      };
    },

    hdel: (key: string, ...fields: string[]): Op => ({
      text: `WITH gone AS (DELETE FROM kv_hashes WHERE key = $1 AND field = ANY($2::text[]) RETURNING 1)
        SELECT count(*)::int FROM gone`,
      params: [name(key), fields.map(name)],
      map: (rows) => Number(rows[0][0]),
    }),

    hgetall: (key: string): Op => ({
      text: "SELECT field, value FROM kv_hashes WHERE key = $1",
      params: [name(key)],
      map: (rows) => parseHashResult(rows.flat()),
    }),

    /** Pages by field, so unlike Redis a concurrent write can neither repeat nor skip an untouched field. */
    hscan: (key: string, cursor: string | number, opts?: { count?: number; match?: string }): Op => {
      if (opts?.match !== undefined) throw new Error("pgRedis: HSCAN MATCH is not implemented");
      const count = opts?.count ?? 10;
      return {
        text: `SELECT field, value FROM kv_hashes WHERE key = $1 AND ($2::text IS NULL OR field > $2::text)
          ORDER BY field LIMIT $3::int`,
        params: [name(key), decodeCursor(cursor), count + 1],
        map: (rows) => {
          const page = rows.slice(0, count);
          const next = rows.length > count ? encodeCursor(page[page.length - 1][0]) : "0";
          return [next, parse(page.flat())];
        },
      };
    },

    hlen: (key: string): Op => ({
      text: "SELECT count(*)::int FROM kv_hashes WHERE key = $1",
      params: [name(key)],
      map: (rows) => Number(rows[0][0]),
    }),

    hincrby: (key: string, field: string, amount: number): Op => ({
      text: `INSERT INTO kv_hashes (key, field, value) VALUES ($1, $2, ($3::bigint)::text)
        ON CONFLICT (key, field) DO UPDATE SET value = (kv_hashes.value::bigint + $3::bigint)::text
        RETURNING value`,
      params: [name(key), name(field), String(amount)],
      map: (rows) => Number(rows[0][0]),
    }),

    sadd: (key: string, ...members: unknown[]): Op => ({
      text: `WITH added AS (
          INSERT INTO kv_sets (key, member) SELECT $1, unnest($2::text[])
          ON CONFLICT DO NOTHING RETURNING 1
        ) SELECT count(*)::int FROM added`,
      params: [name(key), members.map((m) => name(serialize(m)))],
      map: (rows) => Number(rows[0][0]),
    }),

    smembers: (key: string): Op => ({
      text: "SELECT member FROM kv_sets WHERE key = $1",
      params: [name(key)],
      map: (rows) => parse(rows.map((r) => r[0])),
    }),

    /**
     * Compare-and-set on the exact stored string, the Postgres form of the Lua
     * script in lib/mpp/store.ts. null means "absent" on either side.
     */
    casSet: (key: string, expected: string | null, next: string | null): Op => {
      const k = name(key);
      const ok = (rows: Rows) => rows.length > 0;
      if (expected === null && next === null) {
        return { text: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM kv_strings WHERE key = $1 AND ${LIVE})`, params: [k], map: ok };
      }
      if (expected === null) {
        return {
          text: `INSERT INTO kv_strings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL WHERE ${EXPIRED_ROW}
            RETURNING 1`,
          params: [k, next],
          map: ok,
        };
      }
      if (next === null) {
        return { text: `DELETE FROM kv_strings WHERE key = $1 AND value = $2 AND ${LIVE} RETURNING 1`, params: [k, expected], map: ok };
      }
      return {
        text: `UPDATE kv_strings SET value = $3, expires_at = NULL WHERE key = $1 AND value = $2 AND ${LIVE} RETURNING 1`,
        params: [k, expected, next],
        map: ok,
      };
    },
  };
}

// ── Client ───────────────────────────────────────────────────────────────────

type Builders = ReturnType<typeof makeBuilders>;
type Commands = { [K in keyof Builders]: (...args: Parameters<Builders[K]>) => Promise<any> };
export type PgPipeline = { [K in keyof Builders]: (...args: Parameters<Builders[K]>) => PgPipeline } & { exec(): Promise<any[]> };
export type PgRedis = Commands & { pipeline(): PgPipeline; multi(): PgPipeline };

export type PgRedisOptions = {
  /** Like the Upstash option of the same name: false returns stored strings untouched. */
  automaticDeserialization?: boolean;
  /** Share of TTL writes that also delete a batch of expired rows. */
  cleanupRate?: number;
};

// Compute waking up, restarting or out of connections, and aborted deadlocks.
const RETRYABLE_SQLSTATE = /^(08|53300|57P01|57P02|57P03|40P01)/;

function retryable(err: any): boolean {
  if (err?.sourceError) return true; // the fetch itself failed
  if (/^(CONNECTION_|CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|EPIPE)/.test(String(err?.code))) return true; // the TCP connection failed
  if (typeof err?.code === "string") return RETRYABLE_SQLSTATE.test(err.code);
  return /^Server error \(HTTP status 5/.test(String(err?.message));
}

/** The Upstash client retries network failures too, with the same risk of applying a write twice. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 3 || !retryable(err)) throw err;
      await new Promise((res) => setTimeout(res, 100 * 2 ** attempt));
    }
  }
}

type Driver = {
  query: (text: string, params: unknown[]) => Promise<Rows>;
  transaction: (ops: { text: string; params: unknown[] }[]) => Promise<Rows[]>;
};

/** Neon's HTTP driver for Neon, a TCP connection for any other Postgres (such as a Supabase pooler). */
function driverFor(connectionString: string): Driver {
  if (/\.neon\.tech[:/]/.test(connectionString)) {
    const { neon } = require("@neondatabase/serverless");
    // no-store: Next 14 otherwise caches identical POST fetches, and every query here is a POST.
    const sql = neon(connectionString, { arrayMode: true, fullResults: false, fetchOptions: { cache: "no-store" } });
    return {
      query: (text, params) => sql.query(text, params),
      transaction: (ops) => sql.transaction(ops.map((op) => sql.query(op.text, op.params))),
    };
  }
  const postgres = require("postgres");
  // prepare: false for transaction-mode poolers; max 1 because each serverless instance handles one request at a time.
  const sql = postgres(connectionString, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    query: (text, params) => sql.unsafe(text, params as any[]).values(),
    transaction: (ops) =>
      sql.begin(async (tx: any) => {
        const out: Rows[] = [];
        for (const op of ops) out.push(await tx.unsafe(op.text, op.params).values());
        return out;
      }),
  };
}

export function createPgRedis(connectionString: string, options: PgRedisOptions = {}): PgRedis {
  const sql = driverFor(connectionString);

  const raw = options.automaticDeserialization === false;
  const cleanupRate = options.cleanupRate ?? 0.01;
  const builders = makeBuilders(raw ? (v) => v : parseResponse, raw ? (flat) => flat : parseHash) as Record<string, (...args: any[]) => Op>;

  const runOne = async (op: Op) => {
    if (op.ttlWrite && Math.random() < cleanupRate) {
      const [rows] = await withRetry<Rows[]>(() => sql.transaction([op, { text: CLEANUP_SQL, params: [] }]));
      return op.map(rows);
    }
    return op.map(await withRetry<Rows>(() => sql.query(op.text, op.params)));
  };

  const newPipeline = () => {
    const ops: Op[] = [];
    const pipeline: any = {
      exec: async () => {
        if (ops.length === 0) throw new Error("Pipeline is empty");
        const results = await withRetry<Rows[]>(() => sql.transaction(ops));
        return results.map((rows, i) => ops[i].map(rows));
      },
    };
    for (const [cmd, build] of Object.entries(builders)) {
      pipeline[cmd] = (...args: unknown[]) => {
        ops.push(build(...args));
        return pipeline;
      };
    }
    return pipeline as PgPipeline;
  };

  const client: any = { pipeline: newPipeline, multi: newPipeline };
  for (const [cmd, build] of Object.entries(builders)) {
    client[cmd] = async (...args: unknown[]) => runOne(build(...args));
  }
  return client as PgRedis;
}

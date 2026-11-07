-- Postgres storage behind lib/pgRedis.ts. Safe to run repeatedly.
-- COLLATE "C": bytewise ordering, so HSCAN paging is stable and index scans stay cheap.

CREATE TABLE IF NOT EXISTS kv_strings (
  key        text COLLATE "C" PRIMARY KEY,
  value      text NOT NULL,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS kv_strings_expires_at ON kv_strings (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS kv_hashes (
  key   text COLLATE "C" NOT NULL,
  field text COLLATE "C" NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (key, field)
);

CREATE TABLE IF NOT EXISTS kv_sets (
  key    text COLLATE "C" NOT NULL,
  member text COLLATE "C" NOT NULL,
  PRIMARY KEY (key, member)
);

CREATE TABLE IF NOT EXISTS kv_zsets (
  key    text COLLATE "C" NOT NULL,
  member text COLLATE "C" NOT NULL,
  score  double precision NOT NULL,
  PRIMARY KEY (key, member)
);
CREATE INDEX IF NOT EXISTS kv_zsets_key_score ON kv_zsets (key, score DESC, member DESC);

import { Pool } from "pg";

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => {
      console.error("[db] pool error", err);
    });
  }
  return pool;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supabase_id  TEXT UNIQUE NOT NULL,
      email        TEXT NOT NULL,
      name         TEXT NOT NULL,
      avatar_url   TEXT,
      created_at   TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS documents (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL DEFAULT 'Untitled',
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS document_states (
      document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL,
      state        BYTEA NOT NULL,
      byte_size    INTEGER NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (document_id, version)
    );

    CREATE INDEX IF NOT EXISTS document_states_recent_idx
      ON document_states (document_id, version DESC);

    CREATE TABLE IF NOT EXISTS document_permissions (
      document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
      user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
      permission   TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
      granted_at   TIMESTAMPTZ DEFAULT now(),
      granted_by   UUID REFERENCES users(id),
      PRIMARY KEY (document_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS share_links (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
      permission   TEXT NOT NULL CHECK (permission IN ('read', 'write')),
      expires_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log("[db] migrations complete");
}

import "server-only";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export type Row = Record<string, unknown>;
export interface Db {
  kind: "pglite" | "postgres";
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

type Holder = { db?: Promise<Db> };
const g = globalThis as unknown as { __sponsoros?: Holder };
g.__sponsoros ??= {};

async function makePglite(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dir.startsWith("memory://")) (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  const wrap = (exec: { query: typeof pg.query }): Db => ({
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await exec.query(sql, params as never[]);
      return r.rows as T[];
    },
    tx: async (fn) => pg.transaction(async (t) => fn(wrap(t as unknown as { query: typeof pg.query }))),
  });
  return wrap(pg);
}

/** Validates the connection string shape without ever logging it. Returns the SSL mode to use. */
export function inspectDatabaseUrl(url: string): { ssl: "require" | false; warnings: string[] } {
  const warnings: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("DATABASE_URL is not a valid URL (URL-encode special characters in the password, e.g. @ -> %40)"); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL must start with postgresql://");
  const host = u.hostname, port = u.port || "5432";
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (/^db\..+\.supabase\.co$/.test(host)) warnings.push("DATABASE_URL uses the Supabase direct host (IPv6-only); most hosts need the IPv4 pooler (*.pooler.supabase.com:6543).");
  if (host.endsWith("pooler.supabase.com") && port !== "6543") warnings.push("Supabase pooler on port 5432 is session mode; port 6543 (transaction mode) is recommended for this app.");
  if (host.endsWith("pooler.supabase.com") && !u.username.includes(".")) warnings.push("Supabase pooler usernames look like postgres.<project-ref>.");
  const mode = process.env.DATABASE_SSL ?? (local ? "disable" : "require");
  return { ssl: mode === "disable" ? false : "require", warnings };
}

async function makePostgres(url: string): Promise<Db> {
  const postgres = (await import("postgres")).default;
  const { ssl, warnings } = inspectDatabaseUrl(url);
  for (const w of warnings) console.warn("[db]", w);
  // Callers pass JSON for json/jsonb params as already-serialised strings (PGlite convention).
  // postgres.js would JSON.stringify them again -> override so strings pass through unchanged.
  const ser = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));
  const sql = postgres(url, {
    max: 5, prepare: false /* required by the Supabase transaction pooler */, idle_timeout: 20, ssl,
    types: {
      json: { to: 114, from: [114], serialize: ser, parse: (x: string) => JSON.parse(x) },
      jsonb: { to: 3802, from: [3802], serialize: ser, parse: (x: string) => JSON.parse(x) },
    },
  });
  const wrap = (exec: typeof sql): Db => ({
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await exec.unsafe(text, params as never[])) as unknown as T[];
    },
    tx: async (fn) => (await sql.begin(async (t) => fn(wrap(t as unknown as typeof sql)))) as never,
  });
  return { ...wrap(sql), close: () => sql.end({ timeout: 5 }) };
}

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ id: string }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (t) => {
      for (const stmt of m.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query(`INSERT INTO schema_migrations(id) VALUES ($1)`, [m.id]);
    });
  }
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE_IN_PRODUCTION !== "true")
    throw new Error("DATABASE_URL is not set. Refusing to use the embedded PGlite database in production (data would live on an ephemeral filesystem). Set DATABASE_URL, or ALLOW_PGLITE_IN_PRODUCTION=true for a local demo.");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const db = url ? await makePostgres(url) : await makePglite(dir);
  await migrate(db);
  const { importSourceIfNeeded } = await import("./importer");
  await importSourceIfNeeded(db);
  const { seedOperationalConfig } = await import("./config-seed");
  await seedOperationalConfig(db);
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__sponsoros!.db) {
    g.__sponsoros!.db = init().catch((e) => {
      g.__sponsoros!.db = undefined;
      throw e;
    });
  }
  return g.__sponsoros!.db;
}

/** Test helper: run migrations + import against a real PostgreSQL server (postgres.js path). */
export async function createPostgresDbForTests(url: string): Promise<Db> {
  const db = await makePostgres(url);
  await migrate(db);
  const { importSourceIfNeeded } = await import("./importer");
  await importSourceIfNeeded(db);
  const { seedOperationalConfig } = await import("./config-seed");
  await seedOperationalConfig(db);
  return db;
}

/** Test helper: use an isolated in-memory / temp database. */
export async function createDbForTests(dir: string): Promise<Db> {
  const db = await makePglite(dir);
  await migrate(db);
  const { importSourceIfNeeded } = await import("./importer");
  await importSourceIfNeeded(db);
  const { seedOperationalConfig } = await import("./config-seed");
  await seedOperationalConfig(db);
  return db;
}

export async function audit(db: Db, actor: string, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.query(`INSERT INTO audit_events(actor, entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6)`, [
    actor, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
  ]);
}

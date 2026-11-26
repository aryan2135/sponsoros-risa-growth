import "server-only";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export type Row = Record<string, unknown>;
export interface Db {
  kind: "pglite" | "postgres";
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
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

async function makePostgres(url: string): Promise<Db> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  const wrap = (exec: typeof sql): Db => ({
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await exec.unsafe(text, params as never[])) as unknown as T[];
    },
    tx: async (fn) => (await sql.begin(async (t) => fn(wrap(t as unknown as typeof sql)))) as never,
  });
  return wrap(sql);
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

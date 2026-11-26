/**
 * Real PostgreSQL integration (postgres.js driver = production path). Runs only when TEST_DATABASE_URL
 * points at localhost/127.0.0.1 (a disposable server): it DROPS the public schema.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresDbForTests, type Db } from "@/lib/db/client";
import { importSourceIfNeeded } from "@/lib/db/importer";
import { loadState } from "@/lib/analytics/state";
import { computeSnapshot } from "@/lib/analytics/snapshot";
import * as svc from "@/lib/services";
import { PRE } from "./helpers";

const URL_ = process.env.TEST_DATABASE_URL ?? "";
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_);
const n = async (db: Db, sql: string) => Number((await db.query<{ n: number }>(sql))[0].n);

describe.runIf(enabled)("PostgreSQL (postgres.js) end-to-end persistence", () => {
  let db: Db;
  beforeAll(async () => {
    const postgres = (await import("postgres")).default;
    const admin = postgres(URL_, { ssl: "require", max: 1 });
    await admin.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await admin.end();
    process.env.DATABASE_SSL = "require"; // force TLS even on localhost to exercise the production setting
    db = await createPostgresDbForTests(URL_);
  });
  afterAll(async () => { await db?.close?.(); });

  it("connects over SSL", async () => {
    const r = await db.query<{ ssl: boolean }>("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    expect(r[0].ssl).toBe(true);
  });
  it("migrations applied once and are re-runnable", async () => {
    expect(await n(db, "SELECT count(*)::int n FROM schema_migrations")).toBe(1);
    const again = await createPostgresDbForTests(URL_); // migrate + import + seed a second time
    expect(await n(again, "SELECT count(*)::int n FROM schema_migrations")).toBe(1);
    await again.close?.();
  });
  it("source import: dedupe counts, raw rows preserved, idempotent", async () => {
    expect(await n(db, "SELECT count(*)::int n FROM interactions")).toBe(950);
    expect(await n(db, "SELECT count(*)::int n FROM opportunity_history")).toBe(228);
    expect(await n(db, "SELECT count(*)::int n FROM qualification_history")).toBe(433);
    const raw = await n(db, "SELECT count(*)::int n FROM raw_records");
    expect((await importSourceIfNeeded(db)).imported).toBe(false);
    expect(await n(db, "SELECT count(*)::int n FROM raw_records")).toBe(raw);
    expect(await n(db, "SELECT count(*)::int n FROM source_imports")).toBe(1);
  });
  it("analytics on Postgres match the audited figures", async () => {
    const s = computeSnapshot(await loadState(db), PRE);
    expect([s.funnel.attempts, s.funnel.opportunities, s.funnel.confirmed, s.deals.confirmed_cash_inr, s.deals.confirmed_in_kind_inr, s.deals.open_pipeline_inr, s.qualification.qualified])
      .toEqual([369, 58, 24, 2_000_000, 240_000, 1_440_000, 60]);
  });
  it("jsonb settings round-trip without double encoding", async () => {
    await svc.updateSettings(db, { stale_days: 21, collection_policy: { advance_pct: 0.4, advance_due_days_after_signing: 3, balance_due_days_before_festival: 5 } });
    const S = await loadState(db);
    expect(S.settings.stale_days).toBe(21);
    expect(S.settings.collection_policy).toEqual({ advance_pct: 0.4, advance_due_days_after_signing: 3, balance_due_days_before_festival: 5 });
    expect(typeof S.settings.as_of).toBe("string");
  });
  it("writes persist across a brand-new connection pool (simulated redeploy)", async () => {
    const { id } = await svc.createTask(db, { title: "Persistence probe", owner_id: "T01", priority: "high" });
    await svc.updateOpportunity(db, "O004", { stage: "withdrawn", note: "persistence probe" });
    await svc.generateSchedule(db, "O003");
    await db.close?.();
    db = await createPostgresDbForTests(URL_); // new process-equivalent: fresh pool, init runs again
    const S = await loadState(db);
    expect(S.tasks.find((t) => t.id === id)?.title).toBe("Persistence probe");
    const s = computeSnapshot(S, PRE);
    expect(s.opps.find((o) => o.opportunity_id === "O004")!.stage).toBe("withdrawn");
    expect(s.deals.confirmed_cash_inr).toBe(2_000_000 - 150_000);
    expect(S.milestones.filter((m) => m.opportunity_id === "O003").length).toBe(2);
  });
  it("reset restores source state on Postgres", async () => {
    await svc.resetToSource(db);
    const s = computeSnapshot(await loadState(db), PRE);
    expect(s.deals.confirmed_cash_inr).toBe(2_000_000);
    expect(await n(db, "SELECT count(*)::int n FROM tasks")).toBe(0);
  });
});

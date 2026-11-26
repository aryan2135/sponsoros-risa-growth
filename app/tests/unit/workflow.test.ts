/**
 * Integration tests: real services + real Postgres (PGlite in-memory) + analytics + deterministic analyst.
 * Each describe block gets a fresh database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { testDb, PRE } from "./helpers";
import type { Db } from "@/lib/db/client";
import * as svc from "@/lib/services";
import { loadState } from "@/lib/analytics/state";
import { computeSnapshot } from "@/lib/analytics/snapshot";
import { readinessQueue } from "@/lib/analytics/readiness";
import { evaluateThresholds } from "@/lib/analytics/thresholds";
import { buildCtx, runTool } from "@/lib/ai/tools";
import { localAnalyst } from "@/lib/ai/local";

const snap = async (db: Db) => computeSnapshot(await loadState(db), PRE);
const ask = async (db: Db, ...qs: string[]) => localAnalyst(await buildCtx(db), qs.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }) as const));

describe("CRUD workflow updates analytics", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });

  it("create brand + contact + opportunity; stage change appends a version and moves confirmed totals", async () => {
    const { brand_id } = await svc.createBrand(db, { brand_name: "Test Chai Co", industry: "Food and beverage", owner_id: "T01" });
    const { contact_id } = await svc.createContact(db, { brand_id, contact_name: "Asha Test", job_title: "Brand Manager", email: "asha@example.com" });
    const { opportunity_id } = await svc.createOpportunity(db, { brand_id, primary_contact_id: contact_id, support_type: "cash", proposed_value_inr: 300000, campaign_id: "SC02", owner_id: "T01" });
    let s = await snap(db);
    expect(s.funnel.opportunities).toBe(59);
    expect(s.deals.open_pipeline_inr).toBe(1_440_000 + 300_000);
    await svc.updateOpportunity(db, opportunity_id, { stage: "partner_confirmed" });
    s = await snap(db);
    expect(s.deals.confirmed_cash_inr).toBe(2_300_000);
    expect(s.funnel.confirmed).toBe(25);
    const versions = await db.query(`SELECT * FROM opportunity_history WHERE opportunity_id = $1`, [opportunity_id]);
    expect(versions.length).toBe(2); // append-only
  });

  it("marking a source deal lost reduces confirmed cash and leaves the source row intact", async () => {
    await svc.updateOpportunity(db, "O001", { stage: "lost", note: "test" });
    const s = await snap(db);
    expect(s.deals.confirmed_cash_inr).toBe(2_300_000 - 200_000);
    const src = await db.query(`SELECT count(*)::int n FROM opportunity_history WHERE opportunity_id = 'O001' AND origin = 'source'`);
    expect((src[0] as { n: number }).n).toBe(5);
    const raw = await db.query(`SELECT count(*)::int n FROM raw_records WHERE sheet = 'Opportunity history'`);
    expect((raw[0] as { n: number }).n).toBe(228);
  });

  it("rejects edits that would rewrite history before the latest version", async () => {
    await svc.updateSettings(db, { as_of: "2025-02-01T00:00:00+05:30" });
    await expect(svc.updateOpportunity(db, "O002", { stage: "negotiating" })).rejects.toThrow(/earlier than this opportunity's latest version/);
    await svc.updateSettings(db, { as_of: "2025-04-11T23:59:59+05:30" });
  });

  it("validates input (zod) and foreign keys", async () => {
    await expect(svc.createOpportunity(db, { brand_id: "NOPE", support_type: "cash", proposed_value_inr: 1 })).rejects.toThrow(/not found/);
    await expect(svc.createOpportunity(db, { brand_id: "A001", support_type: "barter", proposed_value_inr: 1 })).rejects.toThrow();
    await expect(svc.createTask(db, { title: "x" })).rejects.toThrow();
  });

  it("campaign spend makes cost per confirmed computable", async () => {
    await svc.addSpend(db, "SC04", { amount_inr: 35000 });
    const s = await snap(db);
    const c = s.campaigns.find((x) => x.id === "SC04")!;
    expect(c.spend_inr).toBe(35000);
    expect(c.cost_per_confirmed_inr).toBeCloseTo(35000 / 7, 5);
  });

  it("tasks persist and complete", async () => {
    const { id } = await svc.createTask(db, { title: "Call Beardo", owner_id: "T01", priority: "high", opportunity_id: "O004" });
    await svc.updateTask(db, id, { status: "done", outcome: "Invoice sent" });
    const S = await loadState(db);
    expect(S.tasks.find((t) => t.id === id)?.status).toBe("done");
  });
});

describe("cash ledger rules", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });

  it("policy schedule splits confirmed cash 50/50 and cannot exceed confirmed value", async () => {
    const r = await svc.generateSchedule(db, "O004"); // Mosaic Mobility, 150,000 cash
    expect(r.milestone_ids.length).toBe(2);
    const ms = await db.query<{ amount_inr: number }>(`SELECT amount_inr FROM payment_milestones WHERE opportunity_id='O004' ORDER BY due_at`);
    expect(ms.map((m) => Number(m.amount_inr))).toEqual([75000, 75000]);
    await expect(svc.createMilestone(db, { opportunity_id: "O004", label: "extra", amount_inr: 1, due_at: "2025-04-10T00:00:00+05:30" })).rejects.toThrow(/above the confirmed value/);
    await expect(svc.generateSchedule(db, "O004")).rejects.toThrow(/already has/);
  });

  it("in-kind deals cannot be scheduled or receive cash", async () => {
    await expect(svc.generateSchedule(db, "O005")).rejects.toThrow(/Only confirmed cash/); // Harbor Beverages in-kind
    await expect(svc.recordReceipt(db, { opportunity_id: "O005", amount_inr: 100, reference: "UTR1" })).rejects.toThrow(/In-kind/);
  });

  it("only verified non-test receipts count as cash received; test receipts are shown separately", async () => {
    await svc.recordReceipt(db, { opportunity_id: "O004", amount_inr: 75000, reference: "TEST-UTR-001", verified: true, is_test: true, received_at: "2025-04-10T12:00:00+05:30" });
    let s = await snap(db);
    expect(s.cash.received_verified_inr).toBe(0);
    expect(s.cash.test_receipts_inr).toBe(75000);
    const { id } = await svc.recordReceipt(db, { opportunity_id: "O004", amount_inr: 75000, reference: "DEMO-UTR-002", verified: false, received_at: "2025-04-10T12:00:00+05:30" });
    s = await snap(db);
    expect(s.cash.received_verified_inr).toBe(0);
    expect(s.cash.received_unverified_inr).toBe(75000);
    await svc.verifyReceipt(db, id, true);
    s = await snap(db);
    expect(s.cash.received_verified_inr).toBe(75000);
    expect(s.cash.outstanding_inr).toBe(2_000_000 - 75000);
  });

  it("receipts dated after the clock are invisible at the clock (no leakage)", async () => {
    await svc.recordReceipt(db, { opportunity_id: "O003", amount_inr: 60000, reference: "FUTURE-UTR", verified: true, received_at: "2025-04-15T12:00:00+05:30" });
    const s = await snap(db);
    expect(s.cash.lines.find((l) => l.opportunity_id === "O003")!.received_verified_inr).toBe(0);
  });

  it("overdue milestones are detected and drive the readiness action", async () => {
    await svc.createMilestone(db, { opportunity_id: "O013", label: "Advance", amount_inr: 50000, due_at: "2025-04-01T00:00:00+05:30" });
    const s = await snap(db);
    const line = s.cash.lines.find((l) => l.opportunity_id === "O013")!;
    expect(line.overdue_inr).toBe(50000);
    expect(line.status).toBe("overdue");
    expect(readinessQueue(s).find((r) => r.opportunity_id === "O013")!.action).toBe("Escalate overdue commitment");
  });

  it("the AI actor cannot record receipts", async () => {
    await expect(svc.recordReceipt(db, { opportunity_id: "O004", amount_inr: 1, reference: "AI-1" }, "ai")).rejects.toThrow(/cannot record receipts/);
  });
});

describe("thresholds are data-driven and editable", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });
  it("cold campaigns get STOP, warm get SCALE from stored rules; editing a threshold changes the signal", async () => {
    let S = await loadState(db);
    let sig = evaluateThresholds(S, computeSnapshot(S, PRE));
    const get = (k: string) => sig.find((x) => x.metric_key === k)!;
    expect(get("campaign.SC01.confirmed_per_brand").signal).toBe("stop");
    expect(get("campaign.SC05.confirmed_per_brand").signal).toBe("scale");
    expect(get("collection.on_time_rate").signal).toBe("insufficient_data");
    const t = S.thresholds.find((x) => x.scope === "campaign_rule" && x.metric_key === "confirmed_per_brand")!;
    await svc.updateThreshold(db, t.id, { scale_at: 0.9 });
    S = await loadState(db);
    sig = evaluateThresholds(S, computeSnapshot(S, PRE));
    expect(sig.find((x) => x.metric_key === "campaign.SC05.confirmed_per_brand")!.signal).toBe("change");
  });
});

describe("AI analyst: grounding, honesty, execution with confirmation", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });

  it("historical cash collected is reported UNKNOWN, not invented", async () => {
    const r = await ask(db, "How much cash did we actually collect before the 2025 festival?");
    expect(r.text).toMatch(/UNKNOWN/);
    expect(r.text).toMatch(/₹20,00,000/); // commitment, clearly labelled
    expect(r.text).not.toMatch(/collected ₹20,00,000/i);
  });
  it("ROI without spend data is refused", async () => {
    const r = await ask(db, "What was the historical ROI of Brand Discovery Email?");
    expect(r.text).toMatch(/cannot be calculated/i);
  });
  it("in-kind is never added to cash", async () => {
    const r = await ask(db, "How much confirmed cash-type value do we have?");
    expect(r.text).toMatch(/₹20,00,000 cash-type/);
    expect(r.text).toMatch(/in-kind/);
    expect(r.text).not.toMatch(/₹22,40,000 cash/);
  });
  it("answers reflect changed data (no stale numbers)", async () => {
    await svc.updateOpportunity(db, "O001", { stage: "withdrawn", note: "test" });
    const r = await ask(db, "How much confirmed cash-type value do we have?");
    expect(r.text).toMatch(/₹18,00,000 cash-type/);
  });
  it("follow-up resolves the entity from the previous turn", async () => {
    const r = await ask(db, "Tell me about Mosaic Mobility", "Mosaic Mobility (A003) …", "what is the next best action?");
    expect(r.text).toMatch(/O004/);
    expect(r.text).toMatch(/Issue invoice/);
  });
  it("what-if: collection -10pp is simulated, labelled, and not written anywhere", async () => {
    const before = (await db.query(`SELECT count(*)::int n FROM audit_events`))[0];
    const r = await ask(db, "What happens if the collection rate falls by 10 percentage points?");
    expect(r.text).toMatch(/\[SIMULATION\]/);
    expect(r.tools.map((t) => t.name)).toContain("run_scenario");
    expect((await db.query(`SELECT count(*)::int n FROM audit_events`))[0]).toEqual(before);
  });
  it("propose_task never saves; confirm creates task + recommendation; reject records decision only", async () => {
    const tasksBefore = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM tasks`))[0].n;
    const r = await ask(db, "Which sponsors require immediate intervention?", "…", "Create a task for the top one");
    expect(r.proposals.length).toBe(1);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM tasks`))[0].n).toBe(tasksBefore);
    const p = r.proposals[0] as { recommendation: unknown; task: unknown };
    const ok = await svc.decideRecommendation(db, { recommendation: p.recommendation, decision: "approved", task: p.task }, "ai_confirmed_by_user");
    expect(ok.task_id).toBeTruthy();
    const no = await svc.decideRecommendation(db, { recommendation: p.recommendation, decision: "rejected" });
    expect(no.task_id).toBeNull();
    const recs = await db.query<{ status: string; task_id: number | null }>(`SELECT status, task_id FROM recommendations ORDER BY id`);
    expect(recs.map((x) => x.status)).toEqual(["approved", "rejected"]);
  });
  it("propose_task validates IDs", async () => {
    const out = (await runTool(await buildCtx(db), "propose_task", { title: "x", issue: "y", evidence: "z", owner_id: "T99" })) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
  it("questions outside the dataset are declined with the reason", async () => {
    const r = await ask(db, "How many attendees came because of the Beardo activation?");
    expect(r.text).toMatch(/cannot answer/i);
  });
  it("campaign comparison counts each opportunity once", async () => {
    const out = (await runTool(await buildCtx(db), "compare_campaigns", {})) as { campaigns: { opportunities: number }[] };
    expect(out.campaigns.reduce((a, c) => a + c.opportunities, 0)).toBe(58);
  });
});

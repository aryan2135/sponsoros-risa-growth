import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db/client";
import * as svc from "@/lib/services";
import { buildDashboard } from "@/lib/views";
import { askAnalyst, providerName, type ChatTurn } from "@/lib/ai/analyst";
import { runScenario, monteCarlo, resolve, allEnabled, applyOverrides, ASSUMPTIONS, type Overrides } from "@/lib/model/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type H = (req: NextRequest, p: string[], body: Record<string, unknown>) => Promise<unknown>;
const routes: [string, RegExp, H][] = [];
const on = (method: string, pattern: string, h: H) => routes.push([method, new RegExp("^" + pattern.replace(/:\w+/g, "([^/]+)") + "$"), h]);

on("GET", "health", async () => { const db = await getDb(); return { ok: true, db: db.kind, ai_provider: providerName() }; });
on("GET", "dashboard", async (req) => buildDashboard(await getDb(), req.nextUrl.searchParams.get("asOf")));
on("PATCH", "settings", async (_r, _p, b) => svc.updateSettings(await getDb(), b));
on("POST", "targets", async (_r, _p, b) => svc.setTargets(await getDb(), b));
on("POST", "brands", async (_r, _p, b) => svc.createBrand(await getDb(), b));
on("PATCH", "brands/:id", async (_r, [id], b) => svc.updateBrand(await getDb(), id, b));
on("POST", "brands/:id/qualification", async (_r, [id], b) => svc.setQualification(await getDb(), id, b));
on("POST", "contacts", async (_r, _p, b) => svc.createContact(await getDb(), b));
on("POST", "interactions", async (_r, _p, b) => svc.logInteraction(await getDb(), b));
on("POST", "opportunities", async (_r, _p, b) => svc.createOpportunity(await getDb(), b));
on("PATCH", "opportunities/:id", async (_r, [id], b) => svc.updateOpportunity(await getDb(), id, b));
on("POST", "campaigns", async (_r, _p, b) => svc.createCampaign(await getDb(), b));
on("PATCH", "campaigns/:id", async (_r, [id], b) => svc.updateCampaign(await getDb(), id, b));
on("POST", "campaigns/:id/spend", async (_r, [id], b) => svc.addSpend(await getDb(), id, b));
on("POST", "cash/milestones", async (_r, _p, b) => svc.createMilestone(await getDb(), b));
on("PATCH", "cash/milestones/:id", async (_r, [id], b) => svc.updateMilestone(await getDb(), Number(id), b));
on("POST", "cash/schedule", async (_r, _p, b) => svc.generateSchedule(await getDb(), String(b.opportunity_id)));
on("POST", "cash/receipts", async (_r, _p, b) => svc.recordReceipt(await getDb(), b));
on("PATCH", "cash/receipts/:id", async (_r, [id], b) => svc.verifyReceipt(await getDb(), Number(id), Boolean(b.verified)));
on("POST", "tasks", async (_r, _p, b) => svc.createTask(await getDb(), b));
on("PATCH", "tasks/:id", async (_r, [id], b) => svc.updateTask(await getDb(), Number(id), b));
on("POST", "recommendations/decide", async (_r, _p, b) => svc.decideRecommendation(await getDb(), b as never, String(b.actor ?? "user") === "ai" ? "ai_confirmed_by_user" : "user"));
on("PATCH", "thresholds/:id", async (_r, [id], b) => svc.updateThreshold(await getDb(), Number(id), b));
on("PATCH", "initiatives/:id", async (_r, [id], b) => svc.updateInitiative(await getDb(), id, b));
on("GET", "scenarios", async () => ({ saved: await (await getDb()).query(`SELECT * FROM scenarios ORDER BY id DESC LIMIT 20`), assumptions: ASSUMPTIONS }));
on("POST", "scenarios/run", async (_r, _p, b) => {
  const level = (b.level === "stretch" ? "stretch" : "base") as "base" | "stretch";
  const o = (b.overrides ?? {}) as Overrides;
  const r = runScenario(level, o);
  const mc = b.monte_carlo ? monteCarlo(applyOverrides(resolve(level, allEnabled()), o), 2000) : null;
  if (b.save && b.name) await svc.saveScenario(await getDb(), { name: String(b.name), level, overrides: o as Record<string, unknown>, result: { collected_inr: r.totals.collected_inr, signed: r.totals.signed, monte_carlo: mc } });
  return { ...r, monte_carlo: mc };
});
on("POST", "chat", async (_r, _p, b) => {
  const db = await getDb();
  const msgs = ((b.messages as ChatTurn[]) ?? []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs.at(-1)!.role !== "user") throw new svc.ValidationError("Last message must be from the user");
  const reply = await askAnalyst(db, msgs, { forceLocal: b.mode === "local" });
  const cid = String(b.conversation_id ?? "default").slice(0, 60);
  await db.query(`INSERT INTO chat_log(conversation_id, role, content, provider) VALUES ($1,'user',$2,$3)`, [cid, msgs.at(-1)!.content, reply.provider]);
  await db.query(`INSERT INTO chat_log(conversation_id, role, content, tools_used, provider) VALUES ($1,'assistant',$2,$3,$4)`, [cid, reply.text, JSON.stringify(reply.tools), reply.provider]);
  return reply;
});
on("GET", "audit", async () => (await getDb()).query(`SELECT * FROM audit_events ORDER BY id DESC LIMIT 100`));
on("POST", "admin/reset", async () => {
  if (process.env.ALLOW_RESET === "false") throw new svc.ValidationError("Reset disabled on this deployment");
  await svc.resetToSource(await getDb());
  return { ok: true };
});

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  for (const [m, re, h] of routes) {
    const match = path.match(re);
    if (m !== req.method || !match) continue;
    try {
      const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
      return NextResponse.json(await h(req, match.slice(1).map(decodeURIComponent), body));
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      if (e instanceof svc.ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: (e as Error).message ?? "Server error" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: `No route ${req.method} /api/${path}` }, { status: 404 });
}
export { handle as GET, handle as POST, handle as PATCH };

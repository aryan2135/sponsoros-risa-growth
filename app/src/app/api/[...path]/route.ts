import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db/client";
import * as svc from "@/lib/services";
import { buildDashboard } from "@/lib/views";
import { askAnalyst, providerName, type ChatTurn } from "@/lib/ai/analyst";
import { runScenario, monteCarlo, resolve, allEnabled, applyOverrides, ASSUMPTIONS, type Overrides } from "@/lib/model/engine";
import { GEMINI_MODELS } from "@/lib/ai/gemini";
import { clientIp, rateLimit, resetAllowed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type H = (req: NextRequest, p: string[], body: Record<string, unknown>) => Promise<unknown>;
const routes: [string, RegExp, H][] = [];
const on = (method: string, pattern: string, h: H) => routes.push([method, new RegExp("^" + pattern.replace(/:\w+/g, "([^/]+)") + "$"), h]);

// Public (middleware bypass). Minimal and non-sensitive: proves the DB answers a real query.
on("GET", "health", async () => {
  try { const db = await getDb(); await db.query("SELECT 1"); return { status: "ok" }; }
  catch (e) { console.error("health check failed:", (e as Error).message); return new HealthError(); }
});
// Authenticated operational metadata (no secrets, no connection details).
on("GET", "meta", async () => {
  const db = await getDb();
  let ssl: boolean | null = null;
  if (db.kind === "postgres") { const r = await db.query<{ ssl: boolean }>("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"); ssl = r[0]?.ssl ?? null; }
  const provider = providerName();
  return { db: db.kind === "postgres" ? "postgres" : "pglite", db_ssl: ssl, ai_provider: provider, ai_models: provider === "gemini" ? GEMINI_MODELS : provider === "anthropic" ? [process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5"] : [], reset_enabled: resetAllowed() };
});
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
  if (!Array.isArray(b.messages) || b.messages.length > 30) throw new svc.ValidationError("messages must be an array of at most 30 turns");
  const msgs = ((b.messages as ChatTurn[]) ?? []).slice(-20).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs.at(-1)!.role !== "user") throw new svc.ValidationError("Last message must be from the user");
  const reply = await askAnalyst(db, msgs, { forceLocal: b.mode === "local" });
  const cid = String(b.conversation_id ?? "default").slice(0, 60);
  await db.query(`INSERT INTO chat_log(conversation_id, role, content, provider) VALUES ($1,'user',$2,$3)`, [cid, msgs.at(-1)!.content, reply.provider]);
  await db.query(`INSERT INTO chat_log(conversation_id, role, content, tools_used, provider) VALUES ($1,'assistant',$2,$3,$4)`, [cid, reply.text, JSON.stringify(reply.tools), reply.provider]);
  return reply;
});
on("GET", "audit", async () => (await getDb()).query(`SELECT * FROM audit_events ORDER BY id DESC LIMIT 100`));
on("POST", "admin/reset", async () => {
  if (!resetAllowed()) throw new ForbiddenError("Reset is disabled on this deployment (set ALLOW_RESET=true to enable).");
  await svc.resetToSource(await getDb());
  return { ok: true };
});

class HealthError {}
class ForbiddenError extends Error {}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (req.method !== "GET") {
    const kind = path === "chat" ? "chat" : "write";
    const wait = rateLimit(kind, clientIp(req.headers));
    if (wait) return NextResponse.json({ error: `Rate limit exceeded; retry in ${wait}s` }, { status: 429, headers: { "retry-after": String(wait) } });
  }
  for (const [m, re, h] of routes) {
    const match = path.match(re);
    if (m !== req.method || !match) continue;
    try {
      const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
      const out = await h(req, match.slice(1).map(decodeURIComponent), body);
      if (out instanceof HealthError) return NextResponse.json({ status: "unavailable" }, { status: 503 });
      return NextResponse.json(out);
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      if (e instanceof svc.ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
      console.error(e);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: `No route ${req.method} /api/${path}` }, { status: 404 });
}
export { handle as GET, handle as POST, handle as PATCH };

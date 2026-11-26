import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { testDb } from "./helpers";
import type { Db } from "@/lib/db/client";
import { inspectDatabaseUrl } from "@/lib/db/client";
import { buildCtx } from "@/lib/ai/tools";
import { checkGrounding, extractInr } from "@/lib/ai/grounding";
import { rateLimit, sessionToken, safeEqual, authMode, resetAllowed } from "@/lib/security";

// Gemini adapter reads env at import: fast timeouts for tests
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "m1,m2,m3";
process.env.GEMINI_TIMEOUT_MS = "200";
process.env.GEMINI_DEADLINE_MS = "5000";
process.env.GEMINI_BACKOFF_MS = "10";
process.env.GEMINI_COOLDOWN_MS = "0"; // individual tests opt in to the circuit breaker

const ok = (parts: unknown[]) => new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }), { status: 200 });
const err = (status: number) => new Response(JSON.stringify({ error: { code: status, message: "x" } }), { status });

describe("Gemini adapter resilience (mocked network)", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });
  afterEach(() => vi.unstubAllGlobals());

  async function run(responses: Array<(model: string) => Response | Promise<Response>>) {
    const { askGemini } = await import("@/lib/ai/gemini");
    const seen: string[] = [];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const model = String(url).split("/models/")[1].split(":")[0];
      seen.push(model);
      const r = responses[Math.min(i++, responses.length - 1)];
      if (init.signal) await Promise.resolve();
      return r(model);
    }));
    return { seen, reply: () => askGemini(await_ctx!, [{ role: "user", content: "How much cash do we have confirmed?" }], "system") };
  }
  let await_ctx: Awaited<ReturnType<typeof buildCtx>> | null = null;
  beforeAll(async () => { await_ctx = await buildCtx(db); });

  it("429 on the primary model moves to the next model", async () => {
    const r = await run([() => err(429), () => ok([{ text: "fine" }])]);
    const out = await r.reply();
    expect(r.seen).toEqual(["m1", "m2"]);
    expect(out.provider).toBe("gemini:m2");
  });
  it("500/503 retries the same model once, then succeeds", async () => {
    const r = await run([() => err(503), () => ok([{ text: "recovered" }])]);
    const out = await r.reply();
    expect(r.seen).toEqual(["m1", "m1"]);
    expect(out.text).toBe("recovered");
  });
  it("persistent 500 exhausts retry then falls through the chain", async () => {
    const r = await run([() => err(500), () => err(500), () => ok([{ text: "m2 ok" }])]);
    const out = await r.reply();
    expect(r.seen).toEqual(["m1", "m1", "m2"]);
    expect(out.provider).toBe("gemini:m2");
  });
  it("timeout moves to the next model", async () => {
    const hang = () => new Promise<Response>((_res, rej) => setTimeout(() => rej(Object.assign(new Error("aborted"), { name: "AbortError" })), 250));
    const r = await run([hang, () => ok([{ text: "after timeout" }])]);
    const out = await r.reply();
    expect(out.provider).toBe("gemini:m2");
  });
  it("all models unavailable -> throws (caller falls back to deterministic analyst)", async () => {
    const r = await run([() => err(503)]);
    await expect(r.reply()).rejects.toThrow(/Gemini unavailable/);
  });
  it("401/403 (bad key) stops immediately without leaking provider text", async () => {
    const r = await run([() => err(403)]);
    await expect(r.reply()).rejects.toThrow(/m1: HTTP 403/);
    expect(r.seen).toEqual(["m1"]);
  });
  it("circuit breaker: a model that just failed is skipped on the next question", async () => {
    process.env.GEMINI_COOLDOWN_MS = "60000";
    try {
      const r1 = await run([() => err(429), () => ok([{ text: "from m2" }])]);
      await r1.reply();
      const r2 = await run([() => ok([{ text: "fast path" }])]);
      const out = await r2.reply();
      expect(r2.seen[0]).toBe("m2"); // m1 cooling down -> tried last
      expect(out.provider).toBe("gemini:m2");
    } finally {
      process.env.GEMINI_COOLDOWN_MS = "0";
      (globalThis as unknown as { __gemCool?: Map<string, number> }).__gemCool?.clear();
    }
  });
  it("tool calls execute against live data and their outputs feed grounding", async () => {
    const r = await run([() => ok([{ functionCall: { name: "get_overview", args: {}, id: "c1" } }]), () => ok([{ text: "Confirmed cash-type is ₹20,00,000." }])]);
    const out = await r.reply();
    expect(out.tools.map((t) => t.name)).toEqual(["get_overview"]);
    expect(checkGrounding(out.text, out.toolOutputs)).toEqual({ checked: 1, matched: 1, unmatched: [] });
  });
});

describe("grounding check", () => {
  it("parses INR in Indian grouping, lakh and crore notation", () => {
    expect(extractInr("₹33,64,676 and ₹20.0L and Rs 1.5 crore and ₹75K").map((f) => f.value)).toEqual([3364676, 2000000, 15000000, 75000]);
  });
  it("flags figures not present in tool output", () => {
    const g = checkGrounding("We have ₹20,00,000 confirmed and ₹99,99,999 invented.", [{ confirmed_cash_type_inr: 2000000 }]);
    expect(g).toEqual({ checked: 2, matched: 1, unmatched: ["₹99,99,999"] });
  });
  it("respects written precision (₹38.0L matches 3,801,931)", () => {
    expect(checkGrounding("Base ₹38.0L", [{ collected_inr: 3801931 }]).unmatched).toEqual([]);
  });
});

describe("security helpers", () => {
  it("session token changes when the password rotates; comparison is constant-time-safe", () => {
    expect(sessionToken("a")).not.toBe(sessionToken("b"));
    expect(safeEqual(sessionToken("a"), sessionToken("a"))).toBe(true);
    expect(safeEqual("x", "xy")).toBe(false);
  });
  it("client IP for rate limiting is the proxy-appended (last) X-Forwarded-For hop, not a spoofable first hop", async () => {
    const { clientIp } = await import("@/lib/security");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBe("local");
  });
  it("rate limiter blocks after the limit", () => {
    let blocked = 0;
    for (let i = 0; i < 12; i++) if (rateLimit("login", "test-ip-1")) blocked++;
    expect(blocked).toBe(2);
  });
  it("auth fails closed on Render without APP_PASSWORD; reset fails closed unless exactly 'true'", () => {
    const saved = { ...process.env };
    delete process.env.APP_PASSWORD; process.env.RENDER = "true";
    expect(authMode()).toBe("open"); // public demo on Render
    process.env.REQUIRE_APP_PASSWORD = "true"; expect(authMode()).toBe("misconfigured"); delete process.env.REQUIRE_APP_PASSWORD;
    process.env.APP_PASSWORD = "pw"; expect(authMode()).toBe("password");
    delete process.env.RENDER; delete process.env.APP_PASSWORD; expect(authMode()).toBe("open");
    for (const v of [undefined, "", "false", "TRUE", "1", "yes"]) { if (v === undefined) delete process.env.ALLOW_RESET; else process.env.ALLOW_RESET = v; expect(resetAllowed()).toBe(false); }
    process.env.ALLOW_RESET = "true"; expect(resetAllowed()).toBe(true);
    Object.assign(process.env, saved);
  });
});

describe("DATABASE_URL inspection", () => {
  it("requires SSL for remote hosts, disables for localhost", () => {
    expect(inspectDatabaseUrl("postgresql://postgres.ref:p%40ss@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres")).toEqual({ ssl: "require", warnings: [] });
    expect(inspectDatabaseUrl("postgresql://postgres@localhost:55432/postgres").ssl).toBe(false);
  });
  it("warns on the IPv6-only direct host and on session-mode port", () => {
    expect(inspectDatabaseUrl("postgresql://postgres:x@db.abc.supabase.co:5432/postgres").warnings[0]).toMatch(/IPv6-only/);
    expect(inspectDatabaseUrl("postgresql://postgres.ref:x@aws-0-x.pooler.supabase.com:5432/postgres").warnings[0]).toMatch(/session mode/);
  });
  it("rejects malformed URLs (e.g. unencoded @ in password breaks host parsing)", () => {
    expect(() => inspectDatabaseUrl("not a url")).toThrow(/not a valid URL/);
  });
});

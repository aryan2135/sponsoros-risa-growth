#!/usr/bin/env node
/**
 * SponsorOS deployment smoke test. Never prints secrets.
 *   BASE_URL=https://<app>.onrender.com APP_PASSWORD=*** node scripts/smoke.mjs [--write] [--ai] [--expect-db postgres] [--expect-ai gemini]
 * --write : creates (then cancels) a clearly labelled probe task to prove persistence
 * --ai    : asks the live analyst one question and checks grounding of the answer
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.APP_PASSWORD ?? "";
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const req = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });

(async () => {
  console.log(`Smoke test against ${BASE}\n`);
  // 1. public health: minimal, real DB query behind it
  const h = await req("/api/health");
  const hb = await h.json().catch(() => ({}));
  check("GET /api/health is public and returns 200 {status:'ok'}", h.status === 200 && hb.status === "ok" && Object.keys(hb).length === 1, `HTTP ${h.status} ${JSON.stringify(hb)}`);
  // 2. everything else requires auth (when a password is configured)
  if (PW) {
    for (const [m, p] of [["GET", "/api/dashboard"], ["GET", "/api/meta"], ["POST", "/api/tasks"], ["POST", "/api/chat"], ["POST", "/api/admin/reset"], ["GET", "/api/audit"]]) {
      const r = await req(p, { method: m, headers: { "content-type": "application/json" }, body: m === "GET" ? undefined : "{}" });
      check(`${m} ${p} without session -> 401`, r.status === 401, `HTTP ${r.status}`);
    }
    const page = await req("/");
    check("GET / without session redirects to /login", [302, 307, 308].includes(page.status) && (page.headers.get("location") ?? "").includes("/login"), `HTTP ${page.status}`);
    const bad = await req("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "definitely-wrong-" + Date.now() }) });
    check("wrong password -> 401", bad.status === 401, `HTTP ${bad.status}`);
  } else console.log("SKIP  auth checks (APP_PASSWORD not provided to the smoke test)");
  // 3. security headers
  const hh = await req("/api/health");
  check("security headers present", hh.headers.get("x-frame-options") === "DENY" && hh.headers.get("x-content-type-options") === "nosniff");
  // 4. login and session cookie flags
  let cookie = "";
  if (PW) {
    const ok = await req("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PW }) });
    const sc = ok.headers.get("set-cookie") ?? "";
    cookie = sc.split(";")[0];
    check("correct password -> 200 + session cookie", ok.status === 200 && cookie.startsWith("sponsoros_auth="), `HTTP ${ok.status}`);
    check("cookie is HttpOnly + SameSite=Lax", /httponly/i.test(sc) && /samesite=lax/i.test(sc));
    check("cookie is Secure (https deployments)", !BASE.startsWith("https") || /secure/i.test(sc), BASE.startsWith("https") ? "" : "http target: Secure only enforced when NODE_ENV=production");
  }
  const H = cookie ? { cookie } : {};
  // 5. authenticated meta
  const m = await req("/api/meta", { headers: H });
  const mb = await m.json().catch(() => ({}));
  check("GET /api/meta with session -> 200", m.status === 200, JSON.stringify(mb));
  if (opt("--expect-db")) check(`database is ${opt("--expect-db")}`, mb.db === opt("--expect-db"));
  if (mb.db === "postgres") check("database connection uses SSL", mb.db_ssl === true, `db_ssl=${mb.db_ssl}`);
  if (opt("--expect-ai")) check(`AI provider is ${opt("--expect-ai")}`, mb.ai_provider === opt("--expect-ai"), `models=${(mb.ai_models ?? []).join(",")}`);
  check("reset endpoint disabled (fail closed)", mb.reset_enabled === false);
  const rs = await req("/api/admin/reset", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: "{}" });
  check("POST /api/admin/reset -> 403", rs.status === 403, `HTTP ${rs.status}`);
  // 6. dashboard figures (source data seeded)
  const d = await req("/api/dashboard", { headers: H });
  const db = await d.json().catch(() => ({}));
  check("dashboard loads with seeded source data (58 opportunities, 369 attempts)", d.status === 200 && db.snapshot?.funnel?.opportunities >= 58 && db.snapshot?.funnel?.attempts >= 369);
  // 7. optional persistence probe
  if (flag("--write")) {
    const t = await req("/api/tasks", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ title: `SMOKE TEST probe ${new Date().toISOString()}`, priority: "low" }) });
    const tb = await t.json().catch(() => ({}));
    const again = await (await req("/api/dashboard", { headers: H })).json();
    const found = again.tasks?.some((x) => x.id === tb.id);
    check("write persists and is read back", t.status === 200 && found, `task #${tb.id}`);
    if (tb.id) await req(`/api/tasks/${tb.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled", outcome: "smoke test cleanup" }) });
  }
  // 8. optional live AI check
  if (flag("--ai")) {
    const t0 = Date.now();
    const c = await req("/api/chat", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ conversation_id: "smoke", messages: [{ role: "user", content: "How much confirmed cash-type value do we have, and how much has actually been collected?" }] }) });
    const cb = await c.json().catch(() => ({}));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    check("live AI answered (not the deterministic fallback)", c.status === 200 && /^(gemini|anthropic):/.test(cb.provider ?? ""), `provider=${cb.provider} in ${secs}s`);
    check("AI used backend tools", (cb.tools ?? []).length > 0, (cb.tools ?? []).map((x) => x.name).join(","));
    check("all ₹ figures in the answer trace to tool data", cb.grounding ? cb.grounding.unmatched.length === 0 : true, cb.grounding ? `${cb.grounding.matched}/${cb.grounding.checked} matched${cb.grounding.unmatched.length ? "; unmatched: " + cb.grounding.unmatched.join(", ") : ""}` : "no figures");
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("smoke test crashed:", e.message); process.exit(2); });

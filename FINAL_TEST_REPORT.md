# Final test report (pre-deployment)

> **Post-deployment status note:** All tests in the table below were executed **pre-deployment** (2026-11-27) against local PGlite, a local TLS PostgreSQL 17 container, and the local Next.js production build. Subsequent post-deployment checks verified `GET https://sponsoros-risa-growth.onrender.com/` (HTTP `200`) and `GET https://sponsoros-risa-growth.onrender.com/api/health` (HTTP `200`, `{"status":"ok"}`); the full write/AI `npm run smoke` script has not been re-executed against the live Render URL.

Run on 2026-11-27, Windows 11, Node 24.16, Python 3.13. Raw logs are in [docs/audit_logs/](docs/audit_logs/). The earlier report, [docs/TEST_REPORT.md](docs/TEST_REPORT.md), is kept for history; where they differ, this one supersedes it.

**Test infrastructure:**
- **"Production-like Postgres":** a disposable PostgreSQL 17 container with TLS enabled, bound to `127.0.0.1`, with a throwaway test credential. The compromised Supabase password was **not** used.
- **Live AI:** Google Gemini (free tier).
- **Production server:** `next build` + `next start` with `APP_PASSWORD` set (a test-only value), `ALLOW_RESET=false`, `AI_PROVIDER=gemini` and `DATABASE_SSL=require`.

| # | Area | Command / method | Result | Log |
|---|---|---|---|---|
| 1 | TypeScript | `tsc --noEmit` | **pass** (exit 0) | `typecheck.log` |
| 2 | Lint | `eslint src tests scripts` | **pass** (0 errors, 0 warnings) | `lint.log` |
| 3 | Unit + integration (PGlite) | `vitest run` | **59 passed**, 7 Postgres tests skipped (no server URL) | — |
| 4 | Unit + integration incl. real Postgres/TLS | `TEST_DATABASE_URL=… vitest run` | **66/66 passed** | `vitest.log` |
| 5 | Database migrations | Postgres suite: applied once, re-runnable (`schema_migrations` = 1 after a second init) | **pass** | `vitest.log` |
| 6 | Source seeding + idempotency | 950 / 228 / 433 deduped rows; re-import is a no-op; raw rows preserved; 1 import record | **pass** | `vitest.log` |
| 7 | Analytics on Postgres | 369 attempts, 58 opps, 24 confirmed, ₹20.0L cash, ₹2.4L in-kind, ₹14.4L open, 60 qualified | **pass** | `vitest.log` |
| 8 | jsonb round-trip (Supabase double-encoding regression) | settings objects and strings intact | **pass** | `vitest.log` |
| 9 | Production build | `next build` | **pass** | `build.log` |
| 10 | Playwright e2e (isolated PGlite, deterministic AI) | 8 browser scenarios | **8/8 passed** | `playwright.log` |
| 11 | Health check | public `GET /api/health` → `{"status":"ok"}`; DB stopped → **503** `{"status":"unavailable"}`; DB back → 200 | **pass** | `security-checks.log` |
| 12 | API authentication | 6 protected routes → 401; `/` → 307 /login; wrong password → 401; correct → 200 with cookie | **pass** | `smoke-local-prod.log` |
| 13 | Cookie flags | `Secure; HttpOnly; SameSite=lax; Max-Age=43200` | **pass** | `security-checks.log` |
| 14 | Login rate limit | 12 bad attempts: 401 ×10 then 429 ×2; a different client still 200 | **pass** | `security-checks.log` |
| 15 | Fail-closed auth on Render without a password | health 200; everything else 503 | **pass** | `security-checks.log` |
| 16 | Reset fail-closed | `reset_enabled:false`; POST → 403 | **pass** | `smoke-local-prod.log` |
| 17 | SSL to Postgres | `/api/meta` `db_ssl:true` (`pg_stat_ssl`) | **pass** | `smoke-local-prod.log` |
| 18 | Persistence across refresh | e2e reload checks (stage change, receipts, tasks, CRM) | **pass** | `playwright.log` |
| 19 | Persistence across server restart | task + O021 withdrawal written, process stopped, new process: both present; confirmed cash ₹18.75L | **pass** | `security-checks.log` |
| 20 | Smoke test (production build) | `scripts/smoke.mjs --write --ai --expect-db postgres --expect-ai gemini` | **24/24** | `smoke-local-prod.log` |
| 21 | Gemini live chat via backend | 7-question workflow (honest unknowns, prompt injection, interventions, follow-up task, scenario, out-of-scope) | **all behaved as required**; ₹ grounding 13/13; 2.6–5.2 s per answer once the overloaded model was cooling down (16.6 s on the first) | `gemini-live.log` |
| 22 | Gemini resilience | mocked 429 / 500→retry / persistent 500 / timeout / all-down / 403 / circuit breaker | **pass** (8 tests) | `vitest.log` |
| 23 | Scenario calculations | TS = Python for base, stretch, waterfall, costs and downside; −10pp collection gives ₹30,80,381 in both engines and in the live AI answer | **pass** | `vitest.log`, `gemini-live.log` |
| 24 | Task confirmation | proposal not saved (task count unchanged) → confirm → task with `created_by=ai_confirmed` + approved recommendation | **pass** | `gemini-live.log` |
| 25 | Deck | rebuilt from model v1.1.0; OOXML validator passed; PDF exported via PowerPoint; no stale v1.0.0 figures | **pass** | — |
| 26 | Secret scan after fixes | Gitleaks on the full history + targeted credential search | see [SECURITY_AUDIT.md](SECURITY_AUDIT.md) §1 | `gitleaks_history_post.json` |

## Defects found in this audit and fixed
| Defect | How found | Fix |
|---|---|---|
| `/api/health` would be blocked by `APP_PASSWORD`, so the Render health check would fail | code review | Middleware bypass for exactly `GET /api/health` |
| Reset allowed unless `ALLOW_RESET === "false"` (fail-open) | code review | Allowed only when `=== "true"` |
| Missing `APP_PASSWORD` on Render left the app open | code review | Fails closed with 503 |
| Login rate limit keyed on a spoofable `X-Forwarded-For` first hop | live test | Uses the proxy-appended last hop, plus a global login cap |
| No SSL setting for Postgres | code review | `ssl:"require"` for remote hosts |
| Missing `DATABASE_URL` in production would silently use ephemeral PGlite | code review | Refuses to start without an explicit opt-in |
| Health leaked the DB kind and AI provider | review | Minimal health; details moved to authenticated `/api/meta` |
| The simulator's cash-share lever ignored the per-source renewal share (in-kind could appear as cash at cash-share 0) | unit test | The lever overrides per-source shares |
| Gemini latency ~30 s while the primary model was overloaded | live test | Circuit breaker (5-minute cool-down) → 3–5 s |
| AI wrote an owner ID that wasn't in the tool output ("T04" for T05) | live test | Readiness items expose `owner_id`; prompt rule to copy IDs exactly |
| AI led with "₹0" instead of "UNKNOWN" for 2025 cash | live test | Prompt rule; re-tested: answers lead with UNKNOWN |
| Forecast assumptions optimistic (timing, renewal cash share, overlap); costs omitted | model review | v1.1.0, see FINANCIAL_MODEL_REVIEW.md |

## Not tested (and why)
- **Supabase after the password rotation:** the new password isn't available to me, by design. Verify with the smoke test after deployment.
- **The Render deployment itself:** not deployed (needs the owner's login).
- **The live Anthropic provider:** no key; not used in this deployment.

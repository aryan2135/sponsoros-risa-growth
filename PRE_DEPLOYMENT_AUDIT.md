# Pre-deployment audit: SponsorOS (RISA Labs Challenge B)

> **Post-deployment update:** The owner has completed credential rotation (Supabase database password, Supabase API keys, and Google Gemini API key) and deployed SponsorOS publicly to Render at **https://sponsoros-risa-growth.onrender.com** with `APP_PASSWORD` unset (public demo, no individual accounts/roles) and `ALLOW_RESET=false`. `GET /` and `GET /api/health` (`{"status":"ok"}`) return HTTP `200`. The historical pre-deployment audit notes below are retained for provenance.

**Verdict:** the code is ready to deploy safely. The submission is **not yet complete**: there is no live URL, and the exposed credentials must be rotated first. Nothing was deployed and no secret was pushed during this audit.

| Document | Purpose |
|---|---|
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | secret scan (Gitleaks + targeted), auth, reset, health, DB, AI controls, residual risks |
| [FINANCIAL_MODEL_REVIEW.md](FINANCIAL_MODEL_REVIEW.md) | challenges to the model; v1.0.0 → v1.1.0 with an exact bridge |
| [ASSIGNMENT_REQUIREMENT_MATRIX.md](ASSIGNMENT_REQUIREMENT_MATRIX.md) | every assignment requirement → implementation → test status |
| [FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md) | 26 test areas with logs in `docs/audit_logs/` |

## Summary by priority
1. **Secrets:** Gitleaks found **no leaks in the git history**. The shared credentials exist only in the git-ignored `app/.env.local`, and the compromised database password has been removed from it. `.gitignore` now covers `.env.*` (example template excepted). **Credentials shared in chat must be rotated** (below).
2. **Deployment protection:** `APP_PASSWORD` is in the Render Blueprint as a secret. `ALLOW_RESET` is `"false"` and reset now fails closed. Every page and API is behind the gate except `GET /api/health`, `/login` and `POST /api/login`. There are rate limits on login, chat and writes, and HttpOnly + SameSite=Lax + Secure cookies. A missing password on Render returns 503 instead of an open app. The shared password is a **demo access gate, not multi-user authentication**.
3. **Health check:** a real `SELECT 1`; the body is only `{"status":"ok"}` / `{"status":"unavailable"}` (503). Protected APIs return 401 without a session (verified).
4. **Database:** `ssl:"require"`, `prepare:false`, a startup format check of `DATABASE_URL` (never logged), no PGlite fallback in production, and idempotent migrations and seeding. Persistence was verified across a fresh pool and a full process restart on TLS PostgreSQL.
5. **Gemini:** provider pinned with `AI_PROVIDER=gemini`; server-side key only; retry, fallback chain and circuit breaker; a grounding check on every ₹ figure; no SQL access; tasks require explicit confirmation. Tested live through the backend, not just via a health flag.
6. **Financial model:** base **₹38.0L → ₹35.0L** (timing −₹1.22L, renewal cash share −₹0.65L, de-duplication −₹1.19L), stretch **₹73.7L → ₹70.4L**, new **downside ₹19.5L**, and an explicit **net of costs ₹31.9L**. The workbook, code, README and slides are consistent (regenerated from the model). Historical cash stays **UNKNOWN**.
7. **Requirements:** all assignment components are implemented. Gaps: live URL (pending) and Supabase verification after the rotation (pending).
8. **Tests:** tsc ✓ · eslint ✓ · Vitest 66/66 (incl. real Postgres/TLS) · Playwright 8/8 · production build ✓ · smoke 24/24 · live Gemini workflow ✓ · health/auth/rate-limit/fail-closed checks ✓.

## Remaining manual steps for you (in order)
1. **Rotate the Supabase database password** (Supabase → Project Settings → Database → Reset database password). Use letters and digits only if you can; otherwise URL-encode special characters (`@` → `%40`).
2. **Roll the Supabase API keys** shared in chat (Project Settings → API keys: the secret/service key, and the publishable key if you like). SponsorOS doesn't use them, so nothing in the app changes.
3. **Regenerate the Gemini API key** in Google AI Studio (it was shared in chat) and keep the new key private.
4. **Pick a strong `APP_PASSWORD`** (e.g. 16+ random characters). You'll give it to reviewers in your submission.
5. **Deploy on Render:** New → Blueprint → `aryan2135/sponsoros-risa-growth`. When prompted, enter:
   - `DATABASE_URL` = `postgresql://postgres.<project-ref>:<NEW-url-encoded-password>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
   - `GEMINI_API_KEY` = the new key
   - `APP_PASSWORD` = your chosen password

   Leave the Anthropic variables unset. `ALLOW_RESET=false` and `AI_PROVIDER=gemini` come from the Blueprint.
6. **Wait for "Live"**, then open `https://<service>.onrender.com/api/health`. Expect `{"status":"ok"}`. The first boot creates tables and seeds data in the rotated Supabase database, which takes about 10–20 s.
7. **Run the smoke test against the live URL** (from `app/`):
   `BASE_URL=https://<service>.onrender.com APP_PASSWORD=<pw> npm run smoke -- --write --ai --expect-db postgres --expect-ai gemini`
   It should report 24/24 with `db_ssl=true`. Send me the output, without the password, and I'll update the README with the live link.
8. **Before reviewers look,** open the site once to wake it (the Render free plan sleeps after about 15 minutes idle). Note that the Gemini free tier can be overloaded; the app then answers with the labelled deterministic analyst.
9. **Optional:** when reviewers have finished, change `APP_PASSWORD` in Render to revoke their access.

# SponsorOS — Sponsorship Revenue-to-Cash Operating System

**RISA Labs · Growth APM assignment · Challenge B: Sponsorship growth** · Aryan Dongre (IIT Kharagpur)

> Objective: **maximise sponsorship cash actually collected before the festival.** Confirmed deals, meetings and contacts are leading indicators, not the outcome.

| Deliverable | Where |
|---|---|
| 3-slide strategy (PDF + editable PPTX) | [deliverables/RISA_Growth_Strategy.pdf](deliverables/RISA_Growth_Strategy.pdf), [deliverables/RISA_Growth_Strategy.pptx](deliverables/RISA_Growth_Strategy.pptx) |
| Working product (dashboard, CRM, pipeline, campaigns, cash ledger, tasks, simulator, AI analyst) | [app/](app/) · Supabase Postgres + Google Gemini · deploy with [render.yaml](render.yaml), see [Deployment](#24-deployment) |
| Historical audit (Gate 1) | [outputs/audit/](outputs/audit/): workbook, PDF/DOCX report, CSVs |
| Financial model | [model/assumptions.json](model/assumptions.json), [analysis/financial_model.py](analysis/financial_model.py), [outputs/model/](outputs/model/) |
| External research | [docs/research/EXTERNAL_EVIDENCE.md](docs/research/EXTERNAL_EVIDENCE.md) |
| Tests | [docs/TEST_REPORT.md](docs/TEST_REPORT.md) |
| Screenshots | [docs/screenshots/](docs/screenshots/) |

Labels used throughout: **[SOURCE]** dataset fact · **[CALCULATED]** transparent derivation · **[EXTERNAL]** cited evidence · **[ASSUMPTION]** planning assumption · **[SIMULATION]** model output · **[UNKNOWN]** not established by data.

---

## 1. Executive summary

- **The 2025 data shows commitments, not cash.** At the pre-festival cutoff (11 Apr 2025 23:59 IST) there were 24 confirmed partnerships: **₹20,00,000 cash-type + ₹2,40,000 in-kind** [CALCULATED]. The dataset has **no receipts, invoices or payment dates**, so **cash actually collected is UNKNOWN**. There is also no campaign spend, so CAC and ROI cannot be calculated.
- **Warm channels won and cold channels did not.** All 24 confirmations came from Warm Introductions, Creator Referrals and the Partner Interest Form: 44 brands touched, 24 confirmed. The cold channels touched 148 brands and confirmed **zero** at the cutoff (their one confirmation later withdrew) [CALCULATED; observational, not causal]. The whole ₹14.4L open pipeline is cold-originated, and 25 of its 26 deals are stale (median 43 days in stage).
- **Target for the next edition (Bengaluru): ₹38.0L verified cash before the festival (base), stretch ₹73.7L** [SIMULATION]. Base P10–P90 is ₹27.8L–₹48.2L (Monte Carlo). Repeating the 2025 playbook at the same risk-adjusted rates would collect ₹9.4L.
- **Five ranked bets** add ₹28.6L over BAU for a ₹2.15L budget: (1) Cash Collection Desk, (2) Renewal, tiering & upsell, (3) Qualified-lead recovery + inbound page, (4) Alumni & sponsor referral engine, (5) Creator & community referrals. **Cold outreach is cut** to a 40-brand ABM test.
- **SponsorOS turns this into an operating loop:** detect (thresholds + readiness engine) → diagnose (grounded AI analyst) → decide (human confirms) → do (tasks, payment milestones) → measure (verified receipts only).

## 2. Problem statement

Festival sponsorship teams usually optimise for logos and signatures. The money arrives late or not at all, and nobody owns collection. The assignment asks for the most cash collected *before* the festival. The product therefore has to show where each sponsor deal sits on the path **interest → proposal → commitment → invoice → receipt**, which deals need action today, and what is at risk of missing the deadline.

## 3. Product concept and differentiation

SponsorOS is a revenue-to-cash operating system, not a CRM with charts. Three capabilities carry it:

1. **Cash Conversion Control Tower:** proposed → confirmed cash-type → scheduled → invoiced → due → **verified received** → outstanding → overdue, plus at-risk cash, per-sponsor exposure, a weekly due-vs-received view, and a transparent pre-festival forecast. Unverified, test and in-kind amounts are never counted as cash.
2. **Explainable Cash Readiness Engine:** a rule-based 0–100 score per deal with the exact factors listed and a next-best action (Close immediately · Request confirmation · Send proposal · Resolve decision-maker access · Issue invoice · Follow up on payment · Escalate overdue commitment · Deprioritise). It is explicitly **not** a trained payment probability.
3. **Evidence-to-Action decision system:** issue → evidence → diagnosis → recommended action → expected impact → **user confirmation** → task → outcome, all stored in `recommendations` and `tasks` and visible in the Decision log.

## 4. City rationale — Bengaluru (narrow call)

| Evidence | Source |
|---|---|
| Bengaluru Urban is India's #1 district by number of colleges: 1,148 (AISHE 2023-24), and was also #1 in 2021-22 with 1,106 | [EXTERNAL] Free Press Journal, 2026-10-15; Siasat/PTI, 2024-01-27 (media reports of AISHE) |
| 26 of India's 73 unicorns are in Bengaluru (Delhi-NCR 12, Mumbai 11) | [EXTERNAL] ASK Private Wealth Hurun 2025 via CIOL, 2025-09-17 |
| Over 70% of Karnataka's 21,163 DPIIT startups are in Bengaluru | [EXTERNAL] The Federal, 2026-01-23 |
| Gen Z: 377M people, $860bn spending, 48% of dining and out-of-home entertainment spend | [EXTERNAL] Snap Inc. x BCG, 2024-10-16 |

**Trade-off, stated honestly:** on an unweighted 25-point scorecard Bengaluru and Mumbai tie (21 each). Mumbai and Delhi hold more legacy FMCG and beverage ad budgets, but that advantage rests on qualitative evidence. Bengaluru wins on *verified* student density and on density of new-economy youth brands (fintech/UPI, D2C, quick-commerce). The plan therefore includes a remote pitch track for Mumbai/Delhi CMOs. The full table with URLs, dates and gaps is in [docs/research/EXTERNAL_EVIDENCE.md](docs/research/EXTERNAL_EVIDENCE.md). Unverified items are listed there, including the fact that I did not read the primary AISHE PDF.

## 5. Sponsor ICP

- **Segments (hypotheses):** youth F&B and beverages, D2C personal care and grooming, fintech/UPI, mobility, edtech/media. In 2025 the industries were evenly split (35–37 brands each), and confirmed cash by industry is in `outputs/audit/industry_breakdown.csv`.
- **Selection criteria:** 18–24 audience fit · a warm path exists (alumni, an existing sponsor, a creator, or inbound) · ₹0.5–2L budget band (2025 cash deals: ₹50K–₹2L, median ₹95K) · a Bengaluru decision maker is reachable · will accept a 50% advance.
- **Exclude:** opted-out brands (7 in 2025), and cold lists with no meeting held.

## 6. Historical dataset inventory

`source_documents/Sponsor_Dataset.xlsx` (SHA-256 `12e3db14…b080`) is synthetic. CampusFest 2025 ran 12–13 Apr 2025, and records cover 15 Jan–20 Apr 2025.

| Sheet | Rows | Unique IDs | Notes |
|---|---:|---:|---|
| Brands | 180 | 180 | 6 industries, 3 owners |
| Sponsor contacts | 270 | 270 | |
| Sponsor campaigns | 6 | 6 | no budget or spend columns |
| Sponsor interactions | 953 | 950 | 3 exact import retries |
| Brand qualification | 434 | 433 | full-state history; 1 retry |
| Partner opportunities | 58 | 58 | 54 cash, 4 in-kind; 1 brand has 2 |
| Opportunity history | 230 | 228 | full-state history; 2 retries |
| Sponsor activations | 3 | 3 | links to attendee campaigns; no uplift data |
| Event, Targets, Read me, Field guide | | | Targets: 40/20 → revised 55 qualified / 28 confirmed |

## 7. Data cleaning and cutoff methodology

- **Dedupe:** rows that repeat with the same stable ID **and identical payload** are import retries and were dropped (SI00001, SI00019, SI00110, BQ0003, OH00001, OH00015). A repeated ID with a *different* payload aborts the import; none exist.
- **Snapshots:** pre-festival `2025-04-11 23:59:59 IST` (primary), festival end, and history end. Only records ≤ cutoff are visible, so there is no leakage: 2 interactions and 10 dormant qualification versions fall after the pre-festival cutoff.
- **Full-state histories:** latest version ≤ cutoff per entity, with ties broken by `history_id`. History rows are never summed.
- **Joins on stable IDs only.** Brands, contacts, attempts (one root event each) and opportunities are separate populations.
- **Anomalies investigated** (see the Gate 1 report): O006 was confirmed and then withdrawn. 18 qualified brands have no opportunity. 15 open opportunities belong to brands that never qualified or met. O001 was created before its brand qualified. Confirmed value always equals proposed. Several patterns look synthetic (every confirmed deal passed through all four stages; 19 of 24 confirmed brands share two name prefixes; the warm win rate is 24/25).

## 8. Historical metrics and formulas (pre-festival) [CALCULATED]

| Metric | Value | Formula |
|---|---|---|
| Unique outreach attempts | 369 | distinct root events (no `origin_interaction_id`) ≤ cutoff |
| Brands touched / replied / positive / met | 180 / 109 / 74 / 60 | distinct `brand_id` per event type |
| Qualified brands vs goal | 60 vs 55 (109%) | latest status = qualified |
| Opportunities / confirmed vs goal | 58 / 24 vs 28 (86%) | latest stage |
| Confirmed cash-type / in-kind | ₹20,00,000 / ₹2,40,000 | Σ `confirmed_value_inr` by `support_type` |
| Avg / median confirmed cash deal | ₹1,00,000 / ₹95,000 | 20 cash deals |
| Win rate on closed deals | 75.0% | 24 / (24 + 7 lost + 1 withdrawn) |
| Stage reach | 58 → 52 → 46 → 39 → 25 | opps ever reaching each stage |
| Median days from created to confirmed | 10.1 | |
| Open pipeline | ₹14,40,000, 26 deals, 25 stale >14d | latest stage ∈ open stages |
| **Cash received** | **UNKNOWN** | no receipt ledger in source |

The full KPI list with numerators and denominators for three snapshots is in `outputs/audit/historical_kpis.csv`. Campaign reconciliation is in `outputs/audit/campaign_reconciliation.csv`.

## 9. Financial model

Model engine: [analysis/financial_model.py](analysis/financial_model.py) (Python) and [app/src/lib/model/engine.ts](app/src/lib/model/engine.ts) (identical expected-value logic, enforced by a parity test). All assumptions live in **one file**, [model/assumptions.json](model/assumptions.json), with `bau / base / stretch` values and a stated basis for each.

**Per source:** `prospects × p(conversation) × p(proposal) × p(win) × avg deal`, with **closer capacity** applied (closers × 20 proposals). Capacity goes first to the source with the highest expected value per proposal, so warm deals are served before cold. Then:

```
committed value
 × cash share (0.893 = 2,000,000 / 2,240,000)            → cash-type value   (in-kind removed)
 × (1 − withdrawal 4% = 1/25 confirmations withdrawn)     → net cash-type
 + add-on upsell (attach rate × add-on value)
 × collection rate before T-0                             → CASH COLLECTED PRE-FESTIVAL
collection rate (with Cash Desk) = Σ signing-phase share × P(paid by T-0 | phase)
   base: 0.45×0.95 + 0.40×0.88 + 0.15×0.60 = 0.870 ; stretch 0.925 ; without desk 0.70 [ASSUMPTION]
```

| | BAU (2025 playbook) | **Base** | **Stretch** |
|---|---:|---:|---:|
| Prospects | 234 | 190 | 231 |
| Proposals (capacity) | 45 (80) | 85 (100) | 119 (120) |
| Expected signed deals | 16.4 | 43.7 | 66.5 |
| Committed value | | ₹47.7L | ₹81.2L |
| Cash-type (in-kind removed) | | ₹42.4L | ₹73.1L |
| Withdrawal loss | | −₹1.7L | −₹2.2L |
| Upsell (net) | | +₹3.0L | +₹8.7L |
| Collection rate | 70% | 87.0% | 92.5% |
| **Cash collected before festival** | **₹9.4L** | **₹38.0L** | **₹73.7L** |
| Monte Carlo P10–P90 | | ₹27.8L–₹48.2L | ₹56.8L–₹89.0L |

**Calibration and haircuts.** The 2025 warm brand→signed yield was 54.5% (24/44), with a 96% win rate on warm proposals. That looks synthetic, so the base plan uses **26.8%** and the stretch about **36%**. Cold channels get a non-zero win rate (5–10%) even though 2025 shows zero. The anchor/title tier (₹8L deals) is **excluded from base** and enters stretch only at expected value (8 prospects → 0.5 deals). Expected deals are fractional by design: they are expected values, not whole signed contracts.

**Sensitivity (base ₹38.0L)** — `outputs/model/sensitivity_base.csv`

| Change | Collected | Δ |
|---|---:|---:|
| Renewals fail entirely | ₹28.0L | −26.2% |
| Win rates ×0.8 | ₹30.4L | −20.0% |
| No Cash Collection Desk (70% flat) | ₹30.6L | −19.5% |
| Avg deal −20% | ₹30.9L | −18.6% |
| Warm referral volume −30% | ₹32.6L | −14.4% |
| Collection probabilities −10 pp | ₹33.6L | −11.5% |
| Withdrawal 10% | ₹35.6L | −6.2% |
| Late signings double | ₹35.7L | −6.0% |
| One fewer closer (capacity binds) | ₹37.6L | −1.2% |
| Cold win rate doubled | ₹38.3L | +0.7% |

## 10. Assumptions

The single source is [model/assumptions.json](model/assumptions.json); its `basis` fields mark each value [SOURCE], [CALCULATED] or [ASSUMPTION]. Operating assumptions are editable in the app (Data & Assumptions page): stale-day threshold (14), forecast collection probability (0.87), and the payment policy (50% advance due 2 days after signing, balance due 7 days before the festival).

## 11. Five growth initiatives

| # | Initiative | + Cash base (stretch) | Budget | Team · timeline | Test | Scale / Change / Stop |
|---|---|---:|---:|---|---|---|
| 1 | **Cash Collection Desk**: invoice on signature, 50% advance in 48h, balance at T-7, overdue escalation | +₹7.4L (+₹18.0L) | ₹15K | finance lead 50% · W1–W16 | invoice every signed deal ≤48h (W1–W4) | ≥80% of due cash on time / 60–80% → 100% advance for late signers / never stop; <60% → closers to collections |
| 2 | **Renewal, tiering & upsell**: 2025 proof-of-value recap to 24 sponsors, 3-tier rate card, add-ons | +₹6.9L (+₹13.2L) | ₹60K | 2 closers · W1–W6 | A/B the tier anchor on first 8 pitches | ≥50% → proposal / 25–50% shorten, discount ≤10% / <25% after 12 → renew at 2025 price |
| 3 | **Qualified-lead recovery + inbound page**: pitch 18 qualified-never-pitched brands in 10 days; rate-card page | +₹4.2L (+₹9.8L) | ₹40K | closer 50% + designer · W1–W14 | proposals to all 18 by day 10 | ≥6 in negotiation by W4 / 3–5 re-qualify / <3 → nurture |
| 4 | **Alumni & sponsor referral engine**: 2 warm intros per alumni marketer or renewed sponsor | +₹7.5L (+₹15.7L) | ₹70K | alumni lead + 2 closers 40% · W2–W14 | first 30 asks | ≥0.4 intros/ask & ≥70% → meeting / 0.2–0.4 retarget / <0.2 after 60 asks → stop |
| 5 | **Creator & community referrals**: 8% finder fee paid only on received cash | +₹2.8L (+₹7.4L) | ₹30K + 8% | community lead 50% · W3–W14 | onboard 10 creators by W4 | ≥1.5 referrals/creator / 0.75–1.5 narrow / <0.75 or fees >12% → stop |
| — | Cut cold volume to a 40-brand ABM test; plan capacity | −₹0.2L (+₹0.2L) | — | — | meeting-gated | — |
| | **Total over BAU** | **+₹28.6L** (+₹64.3L) | **₹2.15L** | | | |

**Deprioritised / rejected:** scaling cold email, LinkedIn and revival (148 brands → 0 confirmed, 7 opt-outs) · betting on one title sponsor (no 2025 deal exceeded ₹2L) · chasing the stale ₹14.4L cold pipeline (one close-or-disqualify touch, then archive) · paid ads for sponsor leads (no spend data; buyers are a few hundred marketers).

## 12. Prioritisation method

**Score = incremental pre-festival cash (₹L) × confidence ÷ person-weeks**, with time-to-cash and dependencies applied as tie-breakers. Scores: I1 0.74 · I2 0.64 · I3 0.42 · I4 0.29 · I5 0.17. Contributions come from an **ordered waterfall** (BAU → cut cold → I2 → I3 → I4 → I5 → I1). Each step switches only the parameters its initiative controls, so **the increments sum exactly to the plan with no double counting** (tested in Python and TypeScript). Collection is attributed last because it multiplies every deal. **Dependencies:** I4 uses renewed sponsors from I2 as referrers, and with 4 closers instead of 5 capacity binds.

## 13. Technical architecture

```
Next.js 15 (App Router, TypeScript, Tailwind v4, Recharts)
 ├─ UI pages: Overview · Cash Control Tower · Pipeline · Sponsor CRM · Campaigns & Playbook · Tasks & Decisions · Simulator · AI Analyst · Data & Assumptions
 ├─ /api/[...path]  — one router; zod validation; ValidationError → 400
 ├─ lib/services.ts — every write: validated, transactional, audited (audit_events)
 ├─ lib/analytics/  — deterministic snapshot, readiness engine, threshold evaluator
 ├─ lib/model/      — forecast engine (parity with Python)
 ├─ lib/ai/         — tool layer (12 read tools + propose_task), Anthropic tool loop, deterministic analyst
 └─ lib/db/         — Postgres via PGlite (embedded, file-persisted) or postgres.js when DATABASE_URL is set (Supabase)
```

Every dashboard number is recomputed from the database on each request, as of the **operating clock** (a setting with presets for mid-campaign, the pre-festival cutoff and history end). Edits append new full-state versions stamped at the clock. A change dated before a record's latest version is **refused**, not rewritten.

## 14. Database schema

The versioned migration is `app/src/lib/db/migrations.ts` (`001_core`). Main tables:

- **Provenance:** `source_imports` (file, SHA-256, row counts, dedupe log) and `raw_records` (every source row, unchanged).
- **Operational entities:** `brands`, `contacts`, `campaigns`, `campaign_spend`, `interactions`, `qualification_history`, `opportunities`, `opportunity_history`, `activations`, `targets`, `team_members`, `event`. Each carries an `origin` column (`source`/`app`).
- **Cash:** `payment_milestones` and `receipts`, with `verified` and `is_test` flags.
- **Execution:** `initiatives`, `kpi_thresholds`, `recommendations`, `tasks`.
- **Analysis and system:** `scenarios`, `settings`, `audit_events`, `chat_log`.

The schema enforces primary and foreign keys, CHECK constraints (stages, statuses, non-negative amounts, `confirmed_value = 0 unless partner_confirmed`), indexes on joins and time columns, and timestamps.

## 15. Application modules

Every module reads and writes the same database:

- **Overview:** answers the five operating questions: cash received, cash expected, cash at risk, today's priorities, and which campaigns deserve investment.
- **Cash Control Tower:** schedules (policy-generated or manual), invoicing, receipts (verified/unverified/test), overdue detection, weekly view, forecast bridge.
- **Pipeline:** filters, readiness queue, deal drawer with stage history and factors. Stage, value and owner edits append versions.
- **Sponsor CRM:** brands, qualification versions, contacts, interaction logging (root vs follow-on attempts), new opportunities.
- **Campaigns & Playbook:** status, budget, initiative links, spend entry (cost metrics appear only for recorded spend), editable thresholds with live scale/change/stop signals.
- **Tasks & Decisions:** task lifecycle, outcomes, and a decision log linking recommendation to task to outcome.
- **Scenario Simulator:** 12 levers, base/stretch, waterfall, Monte Carlo band, saved scenarios. It never modifies actual records.
- **Data & Assumptions:** import provenance, gaps, settings, targets, readiness rules, model table, audit trail, reset to source.

## 16. AI architecture

- **Controlled query layer** (`lib/ai/tools.ts`): `get_overview`, `get_funnel`, `compare_campaigns`, `list_opportunities`, `get_entity`, `get_cash_position`, `get_readiness_queue`, `get_threshold_signals`, `get_initiatives_plan`, `run_scenario`, `get_tasks`, `get_breakdown`, `check_data_availability`, `propose_task`. The model has **no SQL and no write access**. Every result is recomputed from the live database and carries `as_of`, definitions and record IDs.
- **LLM path:** the provider is chosen from the environment. **Google Gemini** (`lib/ai/gemini.ts`, the deployed configuration) runs a REST `generateContent` function-calling loop and tries a chain of models in order: `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-lite-latest`, because free-tier capacity varies. Model turns are kept verbatim, since Gemini 3 thought signatures must be echoed back. **Anthropic** (`lib/ai/analyst.ts`) runs a Messages API tool loop on `claude-opus-5-5` with server-side refusal fallbacks and is used when `ANTHROPIC_API_KEY` is set. Both use the same system prompt, which enforces grounding, re-querying on every question, commitment ≠ cash, in-kind ≠ cash, unknown ≠ zero, and no claims of causality. If the provider fails, the deterministic analyst answers and says so.
- **Deterministic analyst** (`lib/ai/local.ts`): used when no key is configured, or as an outage fallback. It routes intents to the same tools, handles follow-ups by resolving the entity from earlier turns, parses what-if questions, and drafts tasks. **It is not an LLM**, and every answer says so.
- **Execution with consent:** `propose_task` returns a draft. The UI shows an editable card; **Confirm** calls `/api/recommendations/decide`, which validates, saves the recommendation and task in one transaction, and logs the decision. **Reject** records the decision only. The AI actor is blocked from recording receipts.
- **Transparency:** each answer has a "Data used" drawer listing the exact tool calls and inputs.

## 17. Grounding and security

- No credentials are in the repo or the frontend. The Anthropic key is server-side only, and `DATABASE_URL` is server-side only.
- Every write is zod-validated with FK checks and transactions, and audited with before/after values.
- Optional `APP_PASSWORD` gates every page and API (an httpOnly SHA-256 cookie). Set it for any public deployment.
- `ALLOW_RESET=false` disables the demo reset endpoint.
- Not implemented: per-user accounts and roles, and Supabase RLS. The app talks to Postgres server-side with a single DB role.

## 18. Installation

Prerequisites: Node 20+ (tested on 24.16), npm, Python 3.11+ (tested 3.13) for the analysis scripts.

```bash
cd app
npm install
npm run dev            # http://localhost:3000 — creates .data/pglite and imports the workbook on first request
```

## 19. Environment variables (`app/.env.local`)

| Var | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | live LLM analyst via Google Gemini (AI Studio key) | unset → deterministic analyst |
| `GEMINI_MODEL` | comma-separated model fallback chain | `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | alternative LLM provider (takes precedence if set) | `claude-opus-5-5` |
| `AI_PROVIDER` | `local` forces the deterministic analyst | auto |
| `DATABASE_URL` | Supabase Postgres: the **IPv4 pooler** URI (port 6543), with the password URL-encoded | unset → embedded PGlite |
| `PGLITE_DIR` | PGlite data directory | `app/.data/pglite` |
| `APP_PASSWORD` | shared password gate | unset → open |
| `ALLOW_RESET` | `false` disables `/api/admin/reset` | enabled |

## 20. Database setup

- **Local:** nothing to do. Migrations, import and config seeding run on first request, idempotently (keyed by the workbook SHA-256 and stable IDs).
- **Supabase:** create a project, then set `DATABASE_URL` to the connection string (Transaction pooler, port 6543; prepared statements are disabled in the client). The app applies `001_core` and imports the data on first request.

## 21. Source data import

```bash
python analysis/export_seed.py   # workbook → app/data/source_seed.json (lossless, with SHA-256)
```

The importer (`app/src/lib/db/importer.ts`) dedupes exact retries, aborts on conflicting payloads, preserves raw rows, and skips the import if that SHA-256 was already imported. Use **Data & Assumptions → Reset to source** to discard app-made changes.

## 22. Testing instructions

```bash
# Analysis (regenerates every audit/model output)
python analysis/historical_audit.py && python analysis/build_audit_workbook.py && python analysis/financial_model.py && python analysis/gate1_report.py
# App
cd app
npx tsc --noEmit && npx eslint src      # types + lint
npx vitest run                           # unit + integration (in-memory Postgres)
npx playwright test                      # browser e2e (own server on :3200, fresh DB; uses installed Edge — PW_CHANNEL=chromium to switch)
```

## 23. Actual test results

The full report is in [docs/TEST_REPORT.md](docs/TEST_REPORT.md). Summary:

- TypeScript compile and ESLint: **0 errors**.
- Vitest: **37/37 passed**. This covers import and idempotency, Python↔TypeScript snapshot parity (21 metrics × 2 snapshots), model parity, waterfall reconciliation, CRUD → analytics, append-only history, cash-ledger rules, thresholds, and AI honesty, changed-data, follow-up, confirm-before-save and validation tests.
- Audit workbook: **19/19** Excel formulas recalculated by the `formulas` engine match the Python audit.
- Playwright e2e: **8/8 passed** on a fresh database. Covered: a UI stage change persists and updates the dashboard; the cash schedule and test-vs-verified receipts; AI insight → proposal → confirm → saved task; the task lifecycle; the simulator; the CRM.
- PPTX: the deck passes the OOXML validator, and PowerPoint export was rendered and visually checked.

## 24. Deployment

**Database: done.** The Supabase project (Tokyo, `ap-northeast-1`) is migrated and loaded with the 2025 data through the IPv4 transaction pooler. The direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from most hosts. Verified from a production build against Supabase: migrate, import, reads, writes, reset, and the live Gemini analyst. All figures match local.

**App on Render (Blueprint in [render.yaml](render.yaml)):**
1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and select the repo. Render reads `render.yaml`: a web service in Singapore (the nearest region to the Tokyo database), root `app/`, build `npm ci --include=dev && npm run build`, start `npm run start`, health check `/api/health`.
3. When prompted, enter the secrets `DATABASE_URL` (pooler URI, e.g. `postgresql://postgres.<ref>:<url-encoded-password>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`) and `GEMINI_API_KEY`.
4. Deploy, then open `/api/health`. It should show `{"db":"postgres","ai_provider":"gemini"}`.

Render's free plan sleeps after inactivity, so the first request after a sleep can take about a minute. Never put the connection string in a `NEXT_PUBLIC_*` variable: those are shipped to the browser. `app/vercel.json` (pinned to `hnd1`) is also included if you prefer Vercel; the same environment variables apply.

**Performance:** the whole state is fetched in one SQL round trip (a JSON aggregate per table), so a dashboard request from India to Tokyo takes about 0.5 s with a warm connection.

## 25. Known limitations

The full list is in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). The main ones:

- Historical cash, CAC and ROI are unknowable from the source; SponsorOS only measures them from data recorded in the app.
- The forecast is an expected-value planning model calibrated on synthetic data with explicit haircuts. It is not validated against real collections.
- The readiness score is a heuristic.
- Campaign attribution is observational.
- The live analyst runs on Gemini's free tier. When every model in the chain is overloaded (HTTP 503/429), it falls back to the deterministic analyst and says so. The Anthropic adapter is implemented and typechecked, but no live call has been run because no key was available.
- Single shared login; no per-user roles or RLS.

## 26. Future improvements

- Calibrate collection probabilities from real receipts once a season of data exists.
- Bank statement / UPI reconciliation import.
- Per-user auth and Supabase RLS.
- Email/WhatsApp reminders for due milestones.
- An evaluation set for the LLM analyst.
- Loss-reason capture.

## Tools used

- Claude Code (Opus 5.5): analysis, code, tests, documents.
- Python with pandas, openpyxl, formulas, reportlab, python-docx, numpy.
- Next.js 15.5.4, React 19, Tailwind 4, Recharts 2.15, zod 3, @electric-sql/pglite 0.3, postgres 3.4, @anthropic-ai/sdk 1.14, Vitest 3, Playwright 1.55.
- pptxgenjs 3.12 for the deck, exported to PDF with Microsoft PowerPoint.
- The web research was done by a Claude research subagent; its sources are in EXTERNAL_EVIDENCE.md.
- Nothing was reused from templates beyond the `create-next-app` scaffold.

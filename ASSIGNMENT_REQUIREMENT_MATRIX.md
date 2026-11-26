# Assignment requirement matrix: RISA Labs Growth APM, Challenge B (Sponsorship)

Status key: **✅ Fully implemented and tested** · **🟡 Implemented, not independently tested** · **🟠 Partially implemented** · **❌ Not implemented**
"Tested" means an automated test or a logged manual check exists (see [FINAL_TEST_REPORT.md](FINAL_TEST_REPORT.md)).

## Part 1: Three-slide strategy
| Requirement (assignment wording) | Implementation | Status | Evidence |
|---|---|---|---|
| Exactly 3 slides, name on slide 1, PDF | `deliverables/RISA_Growth_Strategy.pdf` + editable `.pptx`; "Aryan Dongre · IIT Kharagpur" on slide 1 | ✅ | OOXML validator passed; PowerPoint export renders 3 slides; visual QA |
| Choose a Tier-1 city and justify it | Bengaluru, with a sourced, scored comparison against 5 cities and the trade-off with Mumbai stated | ✅ | `docs/research/EXTERNAL_EVIDENCE.md` (19 sourced rows; gaps listed). Claims come from media reports of AISHE and Hurun, not primary PDFs |
| Slide 1: sponsors, motivations, selection criteria | ICP segments, criteria and exclusions | ✅ | slide 1; README §5 |
| Slide 1: funnel prospects → conversations → proposals → signed → cash | Per-source funnel table + cash bridge (committed → in-kind → withdrawal → upsell → uncollected → cash) | ✅ | model parity tests (Python = TypeScript) |
| Slide 1: conversions, deal sizes, timelines, collectible cash | Calibrated on audited 2025 data with explicit haircuts; signing-phase timing; collection probabilities | ✅ | `FINANCIAL_MODEL_REVIEW.md` |
| Slide 1: realistic base + ambitious stretch | Base ₹35.0L, stretch ₹70.4L, plus downside ₹19.5L and Monte Carlo bands | ✅ | `outputs/model/forecast_summary.json` |
| Slide 2: five distinct ranked strategies | I1–I5 with concept, contribution, budget, team, timeline, test, KPIs and score | ✅ | slide 2; README §11 |
| Slide 2: incremental contribution without overlap | Ordered waterfall; increments sum exactly to the plan | ✅ | unit test "waterfall increments sum exactly" |
| Slide 2: budgets, resources, timeline | Budget ₹2.15L + stipends + finder fees = ₹3.08L all-in | ✅ | model costs test (TS = Python) |
| Slide 2: what to double down on, deprioritise, reject | Double-down, reject and dependency boxes | ✅ | slide 2 |
| Slide 3: critical variables, risks, early signals | Per-initiative table | ✅ | slide 3 |
| Slide 3: measurable scale/change/stop thresholds + actions | Thresholds per initiative, plus plan-level cash gates computed from the model | ✅ | slide 3 |
| Slide 3: how the dashboard and AI support decisions | Decision loop (detect → diagnose → decide → do → measure) | ✅ | slide 3; working in the app |

## Part 2: Growth centre
| Requirement | Implementation | Status | Evidence |
|---|---|---|---|
| Track the complete funnel | Brand funnel + stage conversions with numerators and denominators, as of the operating clock | ✅ | Python↔TS parity on 21 metrics × 2 snapshots; Postgres parity test |
| Campaign-level KPIs | Attempts, brands, meeting rate, opportunities, confirmed, win rate, cash and in-kind confirmed, opt-outs, spend, cost per confirmed | ✅ | integration test (spend → cost per confirmed) |
| Targets vs actuals | Versioned targets (source + app); qualified, confirmed and cash goal | ✅ | e2e overview; unit tests |
| Conversion rates | Stage reach + campaign rates | ✅ | parity tests |
| Budgets / budget management | Campaign budget field + spend ledger; initiative budgets (editable); plan budget + all-in costs in the model | ✅ spend ledger + model costs · 🟡 editing the campaign/initiative budget field | spend → cost-per-confirmed integration test; model-cost parity tests. Budget-field edits were exercised manually, with no automated test |
| Projected outcomes | Live pre-festival cash forecast (received + confirmed × p + pipeline × P(stage)) + next-edition simulator | ✅ | e2e simulator; unit tests |
| Diagnose: performing/underperforming, bottlenecks, drivers | Threshold signals (scale/change/stop) per campaign and initiative; readiness factors; cash bottleneck | ✅ | unit test: thresholds data-driven and editable |
| Support decisions: prioritise, allocate, scale/change/stop | Readiness priority queue; initiative plan with waterfall; editable thresholds | ✅ | unit and e2e |
| Manage campaigns | Create campaign; status, budget, initiative link; spend | ✅ | API/integration tests; UI renders (e2e) |
| Tasks, owners, deadlines, action items | Task CRUD, owner, due date, priority, status, outcome; decision log | ✅ | e2e "task lifecycle persists across reload" |
| Changes update analytics | Every request recomputes from the DB; edits append versions | ✅ | e2e stage change → overview total changes; Postgres restart test |
| Sponsor CRM | Brands, contacts, qualification versions, interaction logging | ✅ | e2e CRM create brand + contact |
| Opportunity pipeline | Filters, priority queue, deal drawer, stage/value/owner versions | ✅ | e2e stage change |
| Cash receipt ledger | Payment milestones (policy or manual), invoicing, verified/unverified/test receipts, overdue | ✅ | 6 cash-ledger integration tests; e2e receipts |
| Persistent changes / reliable updates | PostgreSQL (Supabase in production; SSL; no silent PGlite fallback in production) | ✅ locally against TLS Postgres · 🟡 **on Supabase after the password rotation** | Postgres integration suite (7 tests); process-restart persistence check; earlier Supabase verification used the now-compromised password and must be re-run after rotation |
| Accessible working product (link or demo) | Render Blueprint, smoke-test script, hardened deployment | 🟠 **Not yet deployed.** Needs the owner's Render login and rotated secrets | `render.yaml`, `app/scripts/smoke.mjs` |

## Part 2.5: Embedded AI analyst
| Requirement | Implementation | Status | Evidence |
|---|---|---|---|
| Answers from current app data, not generic knowledge | 14 fixed backend tools (13 read + `propose_task`); recomputed every turn | ✅ | live Gemini log; e2e; unit tests |
| Analyse and diagnose; separate evidence from assumptions | System prompt rules; tool outputs carry definitions, `as_of`, record IDs | ✅ | live log (cash, ROI, interventions, scenario) |
| Recommend actions | Readiness queue + threshold responses | ✅ | live log |
| Connect to execution with user confirmation | `propose_task` returns a draft; Confirm calls `/api/recommendations/decide` (validated, transactional, logged) | ✅ | unit: draft does not write; live: tasks unchanged until confirm, then `created_by=ai_confirmed` |
| Handle uncertainty / say when data can't answer | `check_data_availability`; UNKNOWN for historical cash, ROI and attendee impact | ✅ | live log (4 honesty probes incl. prompt injection) |
| Follow-up questions | History passed; "the first one" resolved to O001 | ✅ | live log; deterministic follow-up unit test |
| Reliable calculations | Every figure computed deterministically by tools; **grounding check** flags any untraced ₹ figure | ✅ | live: 18/18 and 13/13 traced; unit tests for the grounding parser |
| Tested on changed data | Re-queries every turn | ✅ | unit: answer changes from ₹20,00,000 to ₹18,00,000 after an edit |
| No arbitrary SQL | Tools only | ✅ | code review; tool list |
| Not decorative / not hard-coded | Live LLM with tool calls; deterministic fallback is labelled when used | ✅ | live log shows tool calls per answer |

## Scenario simulation
| Requirement | Status | Evidence |
|---|---|---|
| Change budget, prospects, rates, deal size, cash share, collection, withdrawal, capacity; base/stretch/custom; never alter actuals | ✅ | e2e "simulator responds to levers and never touches actuals"; unit tests (incl. the cash-share lever bug found and fixed) |

## README / documentation
| Requirement | Status | Evidence |
|---|---|---|
| Research, assumptions, calculations, data sources, prioritisation, setup, tools, limitations | ✅ | `README.md` (regenerated from model outputs), `docs/*`, this audit set |

## Honest gaps
1. **No live URL yet:** blocked on the owner's Render login, plus rotated Supabase and Gemini credentials.
2. **Supabase persistence after rotation is not yet re-verified.** The production code path is verified against a TLS PostgreSQL server; re-run `npm run smoke -- --write --ai --expect-db postgres --expect-ai gemini` against the Render URL.
3. **The Anthropic adapter was never called live** (no key). It isn't used in this deployment.
4. **The deterministic fallback is template-based.** It only appears when Gemini is unavailable, and it says so.

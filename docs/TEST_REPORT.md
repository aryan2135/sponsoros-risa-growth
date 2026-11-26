# Test report

Environment: Windows 11, Node 24.16, Python 3.13, Next.js 15.5.4. The browser end-to-end tests ran on Microsoft Edge (the Playwright `msedge` channel). All results below are from actual runs. Re-run commands are in README §22.

## 1. Static checks
| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint src` | 0 errors, 0 warnings |
| PPTX OOXML validator (`validate.py`) | All validations PASSED (3 slides) |

## 2. Analysis / data checks (Python)
| Check | Result |
|---|---|
| Duplicate IDs are exact retries (no conflicts) | PASS: 6 retry rows removed, 0 conflicts |
| Foreign-key integrity (10 relations), contact↔brand, origin pointers, one root per attempt | PASS |
| No ambiguous same-timestamp history versions | PASS |
| `confirmed_value = 0` unless `partner_confirmed` | PASS |
| Campaign reconciliation: Σ confirmed = 24, Σ attempts = 369, Σ opportunities = 58 | PASS |
| No post-cutoff leakage into the pre-festival snapshot | PASS |
| Excel audit workbook: formulas recalculated by `formulas` 1.3.4 vs Python | **19/19 PASS** (`outputs/audit/workbook_validation.json`) |

Full list: `outputs/audit/data_quality_report.csv`.

## 3. Unit + integration tests (`npx vitest run`): **37/37 passed**
Each block runs against a real Postgres engine (PGlite, in-memory) built from the original workbook.

| Area | Tests |
|---|---|
| Import | dedupe counts (950 / 228 / 433), retry IDs logged; re-import is a no-op (idempotent) |
| Python ↔ TypeScript parity | 21 metrics identical at pre-festival **and** history-end; zero receipts flagged; no leakage (369 attempts) |
| Financial model | assumptions copy identical; TS = Python totals (base, stretch); waterfall sums exactly and matches Python per step; cash share 0 ⇒ ₹0 collected; −10pp delta matches; Monte Carlo centred (±6%) and ordered |
| CRUD → analytics | new brand/contact/opportunity changes the pipeline; confirming moves confirmed cash (+₹3L); history is append-only; marking O001 lost reduces cash and leaves source rows intact; edits before the latest version are refused; zod/FK validation; spend makes cost per confirmed computable; task completes |
| Cash ledger | 50/50 policy schedule; schedule cannot exceed confirmed value; no duplicate schedule; in-kind cannot be scheduled or receive cash; test receipt excluded; unverified excluded until verified; future-dated receipt invisible at the clock; overdue detected → "Escalate overdue commitment"; AI actor cannot record receipts |
| Thresholds | cold → STOP, warm → SCALE from stored rules; editing a threshold flips the signal |
| AI analyst | see §5 |

## 4. Browser end-to-end (`npx playwright test`): **8/8 passed**
Fresh database and its own server on port 3200, no API key (deterministic analyst).

| # | Scenario | Result |
|---|---|---|
| 1 | Overview shows the five answers, the unknown-cash banner, ₹20.0L commitments | PASS |
| 2 | All 9 modules render (screenshots in `docs/screenshots/`) | PASS |
| 3 | Change Beardo O001 to withdrawn in the Pipeline → reload → Overview shows ₹18.0L | PASS |
| 4 | Cash: generate schedule → record TEST receipt (excluded) → verified receipt → tile shows ₹75K received, ₹75K test | PASS |
| 5 | Analyst: ROI → "cannot be calculated"; intervention list; "create a task for the top one" → proposal card → Confirm → task and approved decision appear in Tasks | PASS |
| 6 | Create task → reload → mark done → visible under the Done filter | PASS |
| 7 | Simulator shows ₹38.0L; collection −10pp → ₹33.6L; Overview actuals unchanged | PASS |
| 8 | CRM: new brand + contact → brand count 181 after reload | PASS |

## 5. AI analyst tests (deterministic path; automated in `workflow.test.ts` and e2e)
| Question / action | Expected behaviour | Actual (abridged) | Pass |
|---|---|---|---|
| "How much cash did we actually collect before the 2025 festival?" | Say UNKNOWN; separate the commitment from cash | "Verified cash received: ₹0. Historical cash collected is UNKNOWN… 20 confirmed cash-type partnerships worth ₹20,00,000 (plus ₹2,40,000 in-kind, never cash). That is not evidence of payment." | ✅ |
| "What was the historical ROI of Brand Discovery Email?" | Refuse; no spend data | "ROI for Brand Discovery Email cannot be calculated. No spend is recorded for SC01…" | ✅ |
| "How much confirmed cash-type value do we have?" | ₹20,00,000 cash-type; in-kind separate | "24 confirmed partnerships: ₹20,00,000 cash-type commitments + ₹2,40,000 in-kind" | ✅ |
| Same question after O001 → withdrawn | Re-query; ₹18,00,000 | "₹18,00,000 cash-type" | ✅ |
| "Tell me about Mosaic Mobility" → "what is the next best action?" | Follow-up resolves the entity | Answer cites O004 and "Issue invoice" | ✅ |
| "What happens if the collection rate falls by 10 percentage points?" | [SIMULATION], `run_scenario`, nothing written | ₹33.6L vs ₹38.0L plan; audit_events unchanged | ✅ |
| "Which sponsors require immediate intervention?" → "Create a task for the top one" | Draft only; DB unchanged until confirm | 1 proposal; task count unchanged; confirm → task + approved recommendation; reject → decision only | ✅ |
| propose_task with owner T99 | Validation rejects | `ok: false, unknown owner_id T99` | ✅ |
| "How many attendees came because of the Beardo activation?" | Decline with reason | "The sponsorship data cannot answer that… no attendee counts…" | ✅ |
| Campaign comparison | Each opportunity counted once | Σ opportunities = 58 | ✅ |
| Adversarial: record a receipt as the AI | Blocked | "The AI analyst cannot record receipts" | ✅ |

**Not tested:** the live Anthropic LLM path. No API key was available, so it has not been run against the API. The adapter is implemented, typechecks, and falls back to the deterministic analyst on any API error.

## 6. Manual / API checks
`curl` against the dev server: `/api/health` → `{"db":"pglite","ai_provider":"local"}`; `/api/dashboard` returns the parity figures (369 attempts, ₹20,00,000 confirmed cash, ₹0 received, forecast ₹17,40,000 at the pre-festival clock).

## 7. Defects found by testing and fixed
| Defect | Found by | Fix |
|---|---|---|
| Waterfall threshold min-sample (20 brands) excluded every warm campaign from judgement | integration test | campaign-rule min sample set to 8 brands |
| "confirmed cash-type" questions were routed to the collection answer | AI test | commitment intent routed before the cash intent |
| I3 KPI read "STOP" while it measured the backlog the initiative exists to clear | screenshot review | KPI changed to qualified-brand opportunity coverage (higher is better) |
| Cash drawer remounted after each receipt and wiped what the user was typing | e2e test 4 (intermittent failure) | drawer keyed by deal only; form cleared explicitly after a successful save. Re-run: 8/8 |
| Slide 1 waterfall bars mis-scaled (undefined max) | visual QA of the PowerPoint render | max computed from step values |

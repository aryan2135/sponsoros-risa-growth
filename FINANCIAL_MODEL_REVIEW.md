# Financial model review (pre-deployment)

Model version reviewed: **v1.0.0** (as first published). Result: **v1.1.0** ([model/assumptions.json](model/assumptions.json), `meta.changelog`).
Historical source figures were not changed. Historical cash receipts remain **UNKNOWN** (the source has no receipt, invoice or payment-date data).

## Headline change

| Case | v1.0.0 | v1.1.0 | Note |
|---|---:|---:|---|
| BAU (repeat 2025 playbook) | ₹9.4L | ₹9.3L | |
| **Base (gross cash collected pre-festival)** | ₹38.0L | **₹35.0L** | P10–P90 ₹25.7L–₹44.8L |
| **Stretch** | ₹73.7L | **₹70.4L** | P10–P90 ₹54.3L–₹86.1L |
| **Downside** (new) | — | **₹19.5L** | P10–P90 ₹13.0L–₹26.5L |
| Base net of plan costs (new) | — | **₹31.9L** | after ₹3.08L of costs |
| Incremental over BAU (base) | ₹28.6L | ₹25.7L | Five initiatives +₹26.2L, cold outreach reduction −₹0.5L |

**Base bridge** ([docs/audit_logs/forecast_bridge_v100_to_v110.log](docs/audit_logs/forecast_bridge_v100_to_v110.log)): ₹38.02L → signing-phase timing −₹1.22L → renewal cash share −₹0.65L → pool de-duplication −₹1.19L → **₹34.96L**.

## Findings

| # | Item investigated | Finding | Evidence | Action |
|---|---|---|---|---|
| 1 | **87% base collection rate** | Optimistic. The rate came from an assumed signing-phase mix of 45% early / 40% mid / 15% late. In 2025, confirmations landed **2 early, 18 mid and 5 late** (8/72/20%), with a median 5.1 weeks before the festival and outreach starting only at T-11.7 weeks. Applying the base payment probabilities to the 2025 mix gives 81%. | [CALCULATED] from Opportunity history ≤ cutoff | Base mix is now 25/55/20, which assumes the plan's T-16 start pulls some mid signings earlier. Collection is **84.2%** (stretch unchanged at 92.5%). The in-app default forecast probability changed from 0.87 to 0.84. |
| 2 | **Renewals: cash vs in-kind sponsors** | The 24 renewal prospects include **4 in-kind** sponsors, but renewals used the blended 89% value-based cash share. | 20 cash / 4 in-kind among sponsors confirmed at cutoff | Per-source cash share for renewals is now **0.83** (20/24); stretch uses 0.85, allowing a little in-kind-to-cash conversion. The simulator's cash-share lever overrides per-source values (a test caught that it didn't at first). |
| 3 | **Overlap among alumni, creator, inbound and cold pools** | The 2025 warm campaigns didn't overlap at all (0 of 44 brands appeared in two of them), but **5 of 44** warm brands were also touched by cold outreach. Future referral pools can overlap. | Root touches by brand × campaign | A **5% de-duplication haircut** on new alumni, creator and inbound prospects. The CRM attributes each brand to one originating source, and the waterfall counts each source once. |
| 4 | **Double counting across initiatives** | None. Contributions come from an ordered waterfall (BAU → cut cold → I2 → I3 → I4 → I5 → I1), and each step switches only the parameters its initiative controls. | Python and TypeScript tests assert Σ increments = forecast exactly | No change. Documented that I1 (collection) is attributed last because it multiplies every deal. |
| 5 | **8% referral success fee** | It was mentioned but **not deducted** anywhere. It's a real variable cost (≈₹0.53L base, ₹1.07L stretch). | 8% × creator-sourced cash collected | Now modelled as a cost. **Gross** cash collected stays the objective metric; **net** is reported alongside it. |
| 6 | **Incremental staffing costs** | Extra closers (+1 base, +2 stretch) were assumed at no cost. | — | **₹10,000/month student stipend × 4 months** [ASSUMPTION]: ₹40K base, ₹80K stretch. All-in base cost is **₹3.08L** (₹2.15L budget + ₹40K + ₹53K), about ₹8 of incremental cash per ₹1. |
| 7 | **₹38L base / ₹73.7L stretch** | They were not wrong in arithmetic, but rested on the optimistic timing above and left out costs and overlap. | — | Replaced by ₹35.0L / ₹70.4L, plus a **₹19.5L downside**: win rates ×0.8, collection −10pp, deal size −10% and warm volume −20%, all at once. The downside is still ≈2× BAU and about equal to 2025's confirmed cash-type commitments. |
| 8 | **Monte Carlo P10–P90** | The band depends on an **assumed** rate-uncertainty concentration (k = 20), which is not estimated from data. | — | The band sensitivity is now reported: base P10–P90 is ₹24.0L–₹46.1L at k=10 and ₹26.5L–₹44.1L at k=40. Treat the band as illustrative of uncertainty, not a confidence interval. |

## What did not change (and why)
- **Warm yield haircut** (2025 brand→signed 54.5% → base 26.8%). The 96% warm win rate looks synthetic, so it is still not used as a forward rate.
- **Cold channels** keep a small positive win rate (5–10%) even though 2025 shows zero. That is deliberately generous to the deprioritised option.
- **Anchor/title tier** is excluded from base and enters stretch only at expected value.
- **The I1 vs I2 ranking.** After the review, I1 scores 0.59 and I2 0.60 (incremental cash × confidence ÷ person-weeks). They are effectively tied, so I1 stays first on the documented tie-breakers: cash from week 1 (vs week 3), and it multiplies every other bet's cash. The slide footnote states this.

## Consistency check (single source of truth)
| Artefact | How it gets the numbers | Verified |
|---|---|---|
| `outputs/model/*.json/.csv` | `analysis/financial_model.py` on `model/assumptions.json` v1.1.0 | regenerated |
| App simulator / AI `run_scenario` | `app/src/lib/model/engine.ts` on an identical copy of the assumptions | Vitest: TS = Python for base, stretch, waterfall, costs and downside; the copy is byte-identical |
| Slides (PPTX/PDF) | `deliverables/build/make_deck.js` reads `forecast_summary.json` and `sensitivity_base.csv` | rebuilt; scan finds no stale v1.0.0 figures |
| README §1, §9, §11, §12, DATA_LINEAGE | `analysis/sync_docs.py` regenerates them from the outputs | regenerated |
| Audit workbook | historical only (unchanged by this review) | 19/19 formulas still valid |

Reproduce: `python analysis/financial_model.py && python analysis/sync_docs.py && node deliverables/build/make_deck.js`.

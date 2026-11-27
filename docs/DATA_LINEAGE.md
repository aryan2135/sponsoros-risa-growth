# Data lineage

```
source_documents/Sponsor_Dataset.xlsx  (SHA-256 12e3db14a56dacb3741b2bc67eeff3e74aff7c9fac0fcf7194800d195608b080; copied unchanged from the user's Downloads)
 ├─ analysis/historical_audit.py ──► outputs/audit/{historical_kpis, data_quality_report, campaign_reconciliation, opportunity_reconciliation, industry_breakdown, owner_breakdown}.csv, audit_snapshot.json
 │    └─ analysis/build_audit_workbook.py ──► Source_Audit_Workbook.xlsx (+ workbook_validation.json, formulas-engine recalculation)
 │    └─ analysis/gate1_report.py ──► Gate_1_Audit_Report.pdf / .docx
 ├─ analysis/export_seed.py ──► app/data/source_seed.json ──► importer ──► raw_records (unchanged) + operational tables (origin='source')
 └─ (calibration figures, labelled [CALCULATED]) ──► model/assumptions.json ──► analysis/financial_model.py ──► outputs/model/*
                                                            └─ copied to app/data/model_assumptions.json (identity enforced by test) ──► app model engine / simulator
outputs/model/forecast_summary.json + outputs/audit/* ──► deliverables/build/make_deck.js ──► deliverables/RISA_Growth_Strategy.pptx ──(PowerPoint 16.0 export)──► deliverables/RISA_Growth_Strategy.pdf
docs/research/EXTERNAL_EVIDENCE.md ──► [EXTERNAL] claims on slide 1 and README §4
```

| Major number | Value | Lineage | Label |
|---|---|---|---|
| Confirmed cash-type commitments (2025) | ₹20,00,000 | latest opportunity version ≤ 11 Apr, support_type = cash | CALCULATED |
| Confirmed in-kind | ₹2,40,000 | same, in_kind | CALCULATED |
| Cash received (2025) | UNKNOWN | no receipt data | UNKNOWN |
| Warm 24/44 vs cold 0/148 | | campaign_reconciliation.csv | CALCULATED |
| Base gross (net) / stretch / downside target | ₹35.0L (₹31.9L net after ₹3.08L costs) / ₹70.4L / ₹19.5L | financial_model.py on assumptions.json v1.1.0 | SIMULATION |
| P10–P90 base (assumption-driven MC) | ₹25.7L–₹44.8L | Monte Carlo, 10,000 runs, seed 7 (not empirical CI) | SIMULATION |
| Initiative increments | e.g. I1 +₹5.9L | ordered waterfall (waterfall_base.csv) | SIMULATION |
| Bengaluru 1,148 colleges; 26/73 unicorns | | EXTERNAL_EVIDENCE.md E1, E10 | EXTERNAL |
| Cash goal for the 2025 dashboard | ₹25,00,000 | 28 × ₹1,00,000 × 0.893 (targets row, origin = app) | ASSUMPTION |

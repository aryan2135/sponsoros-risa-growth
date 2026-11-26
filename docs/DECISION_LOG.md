# Decision Log

| # | Decision | Why | Reversible? |
|---|---|---|---|
| D1 | Primary snapshot = 2025-04-11 23:59:59 IST; also festival_end and history_end snapshots | Objective is cash *before* festival; prevents post-festival leakage | Yes |
| D2 | Drop exact duplicate rows by stable ID; flag same-ID-different-payload as conflict | Workbook Read me defines identical repeats as import retries (6 rows found, 0 conflicts) | Yes |
| D3 | Historical cash collected = UNKNOWN; historical CAC/ROI = not calculable | No receipt, invoice or spend data in source | n/a |
| D4 | Forecast rates = haircuts of 2025 warm-channel rates (base ≈ ½, stretch ≈ ⅔ of historical brand→signed yield) | 2025 warm win rate 24/25 = 96% looks synthetic; must not become a forward rate | Yes — editable in assumptions.json / simulator |
| D5 | Initiative contributions via ordered waterfall (acquisition → value → collection) | Guarantees contributions sum exactly to the forecast; no double counting | Yes |
| D6 | Anchor/title tier excluded from base, EV-only in stretch | Plan must not depend on one extraordinary sponsor | Yes |
| D7 | City = Bengaluru (narrow call vs Mumbai) | Verified #1 district by colleges (AISHE) + highest unicorn HQ density; Mumbai edge rests on unverified/qualitative evidence | Yes |
| D8 | DB: PostgreSQL via PGlite locally (embedded, file-persisted), postgres.js when `DATABASE_URL` set (Supabase) | No Supabase credentials available; same SQL dialect both ways | Yes |
| D9 | AI: provider adapter (Anthropic / Gemini) + deterministic tool-router fallback, clearly labelled when no key | No API key available; deterministic backend computes every number either way | Yes |
| D10 | App edits stamped at an "operating clock" (default = pre-festival cutoff) as new full-state versions | Keeps as-of snapshot logic correct while letting evaluators change data | Yes |

# Known limitations

## Data
- **Historical cash collected is UNKNOWN.** The workbook has no receipts, invoices or payment dates. SponsorOS shows ₹0 *verified* received and never treats commitments as cash.
- **No campaign spend:** historical CAC, cost per partnership and ROI cannot be calculated. Cost metrics appear only for spend recorded in the app.
- The data is synthetic, and several patterns look synthetic: every confirmed deal passed through all four stages, a 24/25 warm win rate, 19 of 24 confirmed brands share two name prefixes, and confirmed value always equals proposed. Forward rates are haircut rather than copied.
- Attribution is observational (originating campaign at opportunity creation); it does not show what caused a deal.
- No loss reasons, sponsor budgets, contracts or tax data. The 3 activation links carry no attendee impact.

## Model
- Expected-value planning model; fractional deals are expectations, not signed contracts.
- Collection probabilities by signing phase, the renewal rates and the deal-size uplift are **assumptions**. With real receipt history they should be recalibrated.
- The Monte Carlo uses an assumed Beta concentration (k = 20) for rate uncertainty.
- The live in-app forecast uses an editable collection probability (0.87), a 0.75 discount on overdue amounts, and a time-to-festival step factor. All are labelled assumptions.

## Product
- **Not deployed.** There is no public URL. Hosting needs Supabase and Vercel credentials and the owner's authorisation (README §24).
- **The LLM analyst was not exercised live**, because no API key was available. The deterministic analyst covers common intents with templated language and says so. Unusual phrasing may get routed to the general overview.
- Edits are stamped at the operating clock. A change dated before a record's latest version is refused, so you move the clock forward rather than rewrite history.
- The readiness score is a transparent heuristic, not a trained model.
- Auth is a single shared password (`APP_PASSWORD`). There are no per-user roles and no Supabase RLS.
- PGlite on serverless hosts is not persistent; use `DATABASE_URL` there.
- The deck's external figures come from media reports of AISHE and Hurun, not the primary PDFs. See `docs/research/EXTERNAL_EVIDENCE.md` §(d).

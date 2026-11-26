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
- The live in-app forecast uses an editable collection probability (0.84, aligned with model v1.1.0), a 0.75 discount on overdue amounts, and a time-to-festival step factor. All are labelled assumptions.

## Product
- **Not deployed yet.** There is no public URL. It needs the owner's Render login and rotated Supabase and Gemini credentials (PRE_DEPLOYMENT_AUDIT.md).
- The live LLM analyst runs on **Gemini's free tier**: capacity and quota vary, and when every model in the chain fails, the labelled deterministic analyst answers (templated language; unusual phrasing may get the general overview). The Anthropic adapter has never been called live (no key).
- The LLM can still word things imperfectly. The grounding check flags any ₹ figure it can't trace to tool output, but it doesn't check non-currency claims.
- Edits are stamped at the operating clock. A change dated before a record's latest version is refused, so you move the clock forward rather than rewrite history.
- The readiness score is a transparent heuristic, not a trained model.
- Auth is a shared-password **demo gate** (`APP_PASSWORD`): no per-user accounts or roles, no CSRF token, no CSP, no Supabase RLS. Rate limits are in memory and per process. See SECURITY_AUDIT.md §6.
- PGlite on serverless hosts is not persistent; use `DATABASE_URL` there.
- The deck's external figures come from media reports of AISHE and Hurun, not the primary PDFs. See `docs/research/EXTERNAL_EVIDENCE.md` §(d).

"""Regenerates the forecast-dependent sections of README.md and docs/DATA_LINEAGE.md from outputs/model/*.
Run after analysis/financial_model.py so documentation never drifts from the validated model."""
import json
import re
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
F = json.loads((ROOT / "outputs/model/forecast_summary.json").read_text(encoding="utf-8"))
A = json.loads((ROOT / "model/assumptions.json").read_text(encoding="utf-8"))
sens = pd.read_csv(ROOT / "outputs/model/sensitivity_base.csv")
B, S, D = F["base"], F["stretch"], F["downside"]
bt, st, dt = B["totals"], S["totals"], D["totals"]
L = lambda v, d=1: f"{'−' if v < 0 else ''}₹{abs(v) / 1e5:.{d}f}L"
wfb = {w["step"]: w for w in B["waterfall"]}
wfs = {w["step"]: w for w in S["waterfall"]}
I = {i["id"]: i for i in A["initiatives"]}
score = lambda k: wfb[k]["increment_inr"] / 1e5 * I[k]["confidence"] / I[k]["person_weeks"]
inc_b = bt["collected_inr"] - B["bau_collected_inr"]
inc_s = st["collected_inr"] - S["bau_collected_inr"]
mix = A["global"]["collection"]["signing_phase_mix"]["base"]
prob = A["global"]["collection"]["collect_prob_by_phase"]["base"]
_, bau_t = None, None

readme = (ROOT / "README.md").read_text(encoding="utf-8")


def sub(pattern, repl, text, flags=re.S):
    new, n = re.subn(pattern, lambda m: repl, text, flags=flags)
    assert n == 1, f"pattern not found exactly once: {pattern[:60]}"
    return new


readme = sub(r"- \*\*Target for the next edition \(Bengaluru\):.*?\n- \*\*Five ranked bets\*\*.*?test\.\n",
             f"- **Target for the next edition (Bengaluru): {L(bt['collected_inr'])} verified cash before the festival (base), stretch {L(st['collected_inr'])}, downside {L(dt['collected_inr'])}** [SIMULATION]. Base P10–P90 is {L(B['monte_carlo']['p10'])}–{L(B['monte_carlo']['p90'])} (Monte Carlo). Repeating the 2025 playbook at the same risk-adjusted rates would collect {L(B['bau_collected_inr'])}. Net of every plan cost (₹{B['costs']['total_cost_inr'] / 1e5:.2f}L: budget, closer stipends, finder fees), base is {L(B['costs']['net_cash_after_costs_inr'])}. Model v{A['meta']['version']}: the pre-deployment review lowered the base from ₹38.0L ([docs/FINANCIAL_MODEL_REVIEW.md](FINANCIAL_MODEL_REVIEW.md)).\n"
             f"- **Five ranked bets** add {L(inc_b)} over BAU for {L(B['costs']['total_cost_inr'], 2)} all-in (₹{F['budget_inr'] / 1e5:.2f}L budget): (1) Cash Collection Desk, (2) Renewal, tiering & upsell, (3) Qualified-lead recovery + inbound page, (4) Alumni & sponsor referral engine, (5) Creator & community referrals. **Cold outreach is cut** to a 40-brand ABM test.\n", readme)

sec9 = f"""**Per source:** `prospects × p(conversation) × p(proposal) × p(win) × avg deal`, with **closer capacity** applied (closers × 20 proposals). Capacity goes first to the source with the highest expected value per proposal, so warm deals are served before cold. New referral and inbound prospect pools take a 5% de-duplication haircut. Then:

```
committed value
 × cash share (0.893 = 2,000,000 / 2,240,000; renewals 0.83 = 20 of 24 were cash) → cash-type value (in-kind removed)
 × (1 − withdrawal 4% = 1/25 confirmations withdrawn)                             → net cash-type
 + add-on upsell (attach rate × add-on value)
 × collection rate before T-0                                                     → CASH COLLECTED PRE-FESTIVAL (gross: the objective)
 − initiative budget − closer stipends − 8% creator finder fees                   → net contribution (reported alongside)
collection rate (with Cash Desk) = Σ signing-phase share × P(paid by T-0 | phase)
   base: {mix[0]}×{prob[0]} + {mix[1]}×{prob[1]} + {mix[2]}×{prob[2]} = {bt['collection_rate']:.3f}
   (2025 confirmations were 8% early / 72% mid / 20% late with a T-11.7w start, which gives 0.81)
   stretch {st['collection_rate']:.3f}; without the desk 0.70 [ASSUMPTION]
```

| | BAU (2025 playbook) | **Base** | **Stretch** | Downside |
|---|---:|---:|---:|---:|
| Prospects | 234 | {bt['prospects']:.0f} | {st['prospects']:.0f} | {dt['prospects']:.0f} |
| Proposals (capacity) | 45 (80) | {bt['proposals']:.0f} ({bt['capacity_proposals']}) | {st['proposals']:.0f} ({st['capacity_proposals']}) | {dt['proposals']:.0f} ({dt['capacity_proposals']}) |
| Expected signed deals | 16.4 | {bt['signed']:.1f} | {st['signed']:.1f} | {dt['signed']:.1f} |
| Committed value | | {L(bt['committed_inr'])} | {L(st['committed_inr'])} | {L(dt['committed_inr'])} |
| Cash-type (in-kind removed) | | {L(bt['cash_type_inr'])} | {L(st['cash_type_inr'])} | {L(dt['cash_type_inr'])} |
| Withdrawal loss | | {L(-bt['withdrawal_loss_inr'])} | {L(-st['withdrawal_loss_inr'])} | {L(-dt['withdrawal_loss_inr'])} |
| Upsell (net) | | +{L(bt['upsell_net_cash_inr'])} | +{L(st['upsell_net_cash_inr'])} | +{L(dt['upsell_net_cash_inr'])} |
| Collection rate | 70% | {bt['collection_rate'] * 100:.1f}% | {st['collection_rate'] * 100:.1f}% | {dt['collection_rate'] * 100:.1f}% |
| **Cash collected before festival (gross)** | **{L(B['bau_collected_inr'])}** | **{L(bt['collected_inr'])}** | **{L(st['collected_inr'])}** | **{L(dt['collected_inr'])}** |
| Plan costs (budget + stipends + finder fees) | | {L(B['costs']['total_cost_inr'], 2)} | {L(S['costs']['total_cost_inr'], 2)} | {L(D['costs']['total_cost_inr'], 2)} |
| Net after costs | | {L(B['costs']['net_cash_after_costs_inr'])} | {L(S['costs']['net_cash_after_costs_inr'])} | {L(D['costs']['net_cash_after_costs_inr'])} |
| Monte Carlo P10–P90 | | {L(B['monte_carlo']['p10'])}–{L(B['monte_carlo']['p90'])} | {L(S['monte_carlo']['p10'])}–{L(S['monte_carlo']['p90'])} | {L(D['monte_carlo']['p10'])}–{L(D['monte_carlo']['p90'])} |

The downside case runs the base plan with win rates ×0.8, collection −10pp, deal size −10% and new warm volume −20%, all at once. The Monte Carlo band depends on the assumed rate uncertainty: base P10–P90 is {L(F['mc_band_sensitivity']['k=10']['p10'])}–{L(F['mc_band_sensitivity']['k=10']['p90'])} at k=10 (wider), and {L(F['mc_band_sensitivity']['k=40']['p10'])}–{L(F['mc_band_sensitivity']['k=40']['p90'])} at k=40.

**Calibration and haircuts.** The 2025 warm brand→signed yield was 54.5% (24/44), with a 96% win rate on warm proposals. That looks synthetic, so the base plan uses **26.8%** and the stretch about **36%**. Cold channels get a non-zero win rate (5–10%) even though 2025 shows zero. The anchor/title tier (₹8L deals) is **excluded from base** and enters stretch only at expected value (8 prospects → 0.5 deals). Expected deals are fractional by design: they are expected values, not whole signed contracts.

**Sensitivity (base {L(bt['collected_inr'])})**: `outputs/model/sensitivity_base.csv`

| Change | Collected | Δ |
|---|---:|---:|
""" + "\n".join(f"| {r.test} | {L(r.collected_inr)} | {r.delta_pct * 100:+.1f}% |" for r in sens.sort_values("delta_pct").itertuples()) + "\n"
readme = sub(r"\*\*Per source:\*\*.*?\n## 10\. Assumptions", sec9 + "\n## 10. Assumptions", readme)
readme = readme.replace("forecast collection probability (0.87)", f"forecast collection probability ({A['global']['collection']['signing_phase_mix'] and round(bt['collection_rate'], 2)})")


def row(k, num, name, rest):
    return f"| {num} | {name} | +{L(wfb[k]['increment_inr'])} (+{L(wfs[k]['increment_inr'])}) | {rest}"


lines = readme.split("\n")
for i, l in enumerate(lines):
    for k, num in (("I1", "1"), ("I2", "2"), ("I3", "3"), ("I4", "4"), ("I5", "5")):
        if l.startswith(f"| {num} | **"):
            parts = l.split(" | ")
            parts[2] = f"+{L(wfb[k]['increment_inr'])} (+{L(wfs[k]['increment_inr'])})"
            lines[i] = " | ".join(parts)
    if l.startswith("| — | Cut cold volume"):
        parts = l.split(" | ")
        parts[2] = f"{L(wfb['PLAN']['increment_inr'])} ({'+' if wfs['PLAN']['increment_inr'] >= 0 else ''}{L(wfs['PLAN']['increment_inr'])})"
        lines[i] = " | ".join(parts)
    if l.startswith("| | **Total over BAU** |"):
        lines[i] = f"| | **Total over BAU** | **+{L(inc_b)}** (+{L(inc_s)}) | **₹{F['budget_inr'] / 1e5:.2f}L** + ₹{B['costs']['closer_stipend_inr'] / 1000:.0f}K stipend + ₹{B['costs']['finder_fees_inr'] / 1000:.0f}K finder fees (base) | | | |"
readme = "\n".join(lines)
readme = sub(r"Scores: I1 [\d.]+ · I2 [\d.]+ · I3 [\d.]+ · I4 [\d.]+ · I5 [\d.]+\.",
             f"Scores: I1 {score('I1'):.2f} · I2 {score('I2'):.2f} · I3 {score('I3'):.2f} · I4 {score('I4'):.2f} · I5 {score('I5'):.2f}. I1 and I2 are within {abs(score('I1') - score('I2')):.2f} of each other, so I1 ranks first on the tie-breakers: cash from week 1 (vs week 3), and it multiplies every other bet's cash.", readme)
(ROOT / "README.md").write_text(readme, encoding="utf-8")

lin = (ROOT / "docs/DATA_LINEAGE.md").read_text(encoding="utf-8")
lin = re.sub(r"\| Base / stretch target \|.*?\n", f"| Base / stretch / downside target | {L(bt['collected_inr'])} / {L(st['collected_inr'])} / {L(dt['collected_inr'])} | financial_model.py on assumptions.json v{A['meta']['version']} | SIMULATION |\n", lin)
lin = re.sub(r"\| P10–P90 base \|.*?\n", f"| P10–P90 base | {L(B['monte_carlo']['p10'])}–{L(B['monte_carlo']['p90'])} | Monte Carlo, 10,000 runs, seed 7 | SIMULATION |\n", lin)
lin = re.sub(r"\| Initiative increments \|.*?\n", f"| Initiative increments | e.g. I1 +{L(wfb['I1']['increment_inr'])} | ordered waterfall (waterfall_base.csv) | SIMULATION |\n", lin)
(ROOT / "docs/DATA_LINEAGE.md").write_text(lin, encoding="utf-8")
print("README + DATA_LINEAGE synced to model", A["meta"]["version"], "base", L(bt["collected_inr"]))

"""
Cash-first sponsorship forecast for the next CampusFest edition.

Single source of truth for assumptions: model/assumptions.json
The SponsorOS app implements the identical engine in TypeScript (app/src/lib/model/engine.ts);
tests/model_parity compares both on the same inputs.

Run: python analysis/financial_model.py
Outputs -> outputs/model/
"""
from __future__ import annotations
import json, copy
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
A = json.loads((ROOT / "model" / "assumptions.json").read_text(encoding="utf-8"))
OUT = ROOT / "outputs" / "model"
OUT.mkdir(parents=True, exist_ok=True)

# 2025 confirmed cash-type deal values (pre-festival snapshot) - used only to shape the deal-size
# distribution in the Monte Carlo (scaled to each source's planned average).
DEALS_2025 = np.array([50000, 50000, 65000, 65000, 80000, 80000, 90000, 90000, 90000, 95000, 95000,
                       105000, 105000, 110000, 110000, 120000, 125000, 125000, 150000, 200000], dtype=float)
DEAL_SHAPE = DEALS_2025 / DEALS_2025.mean()

STEPS = [  # waterfall order = logical dependency order (acquisition -> value -> collection)
    ("BAU", "Repeat 2025 playbook (BAU)"),
    ("PLAN", "Cut cold volume to ABM test + plan capacity"),
    ("I2", "I2 Renewal, Tiering & Upsell"),
    ("I3", "I3 Qualified-Lead Recovery + Inbound Page"),
    ("I4", "I4 Alumni & Sponsor Referral Engine"),
    ("I5", "I5 Creator & Community Referrals"),
    ("I1", "I1 Cash Collection Desk"),
]


def resolve(level: str, enabled: set[str], a=A):
    """Return a flat parameter set: each source/global uses `level` if its controlling step is enabled, else 'bau'."""
    g = a["global"]
    plan_on = "PLAN" in enabled
    lv = lambda on: level if on else "bau"
    p = {
        "cash_share": g["cash_share_of_committed_value"][lv(plan_on)],
        "withdrawal": g["post_signing_withdrawal_rate"][lv(plan_on)],
        "closers": g["closers"][lv(plan_on)],
        "proposals_per_closer": g["proposals_per_closer"][lv(plan_on)],
        "collection_desk": "I1" in enabled,
        "bau_collection": g["collection"]["bau_flat_rate"],
        "phase_mix": g["collection"]["signing_phase_mix"][level if level != "bau" else "base"],
        "phase_prob": g["collection"]["collect_prob_by_phase"][level if level != "bau" else "base"],
        "attach": g["upsell"]["attach_rate"][lv("I2" in enabled)],
        "addon": g["upsell"]["addon_cash_inr"][lv("I2" in enabled)],
        "sources": [],
    }
    dedup = g["prospect_dedup_factor"][lv(plan_on)]
    for s in a["sources"]:
        ctrl = s["initiative"]
        on = (ctrl == "DEPRIORITISE" and plan_on) or (ctrl in enabled)
        L = lv(on)
        p["sources"].append(dict(id=s["id"], name=s["name"], initiative=ctrl,
                                 prospects=s["prospects"][L] * (dedup if s.get("dedup") else 1.0), conv=s["p_conversation"][L], prop=s["p_proposal"][L],
                                 win=s["p_win"][L], deal=s["avg_deal_inr"][L],
                                 cash_share=(s["cash_share"][L] if "cash_share" in s else None)))
    return p


def apply_overrides(p, o):
    """Mirror of app/src/lib/model/engine.ts applyOverrides (subset used by the downside case and sensitivities)."""
    p = copy.deepcopy(p)
    for s in p["sources"]:
        if "win_multiplier" in o: s["win"] = min(1.0, s["win"] * o["win_multiplier"])
        if "deal_multiplier" in o: s["deal"] *= o["deal_multiplier"]
        if "warm_prospects_multiplier" in o and s["id"] in ("alumni_referral", "creator_referral", "inbound"): s["prospects"] *= o["warm_prospects_multiplier"]
    if "collection_prob_delta" in o:
        p["phase_prob"] = [max(0.0, min(1.0, x + o["collection_prob_delta"])) for x in p["phase_prob"]]
        p["bau_collection"] = max(0.0, min(1.0, p["bau_collection"] + o["collection_prob_delta"]))
    return p


def cs(p, s):
    return s["cash_share"] if s.get("cash_share") is not None else p["cash_share"]


def costs(level, t, df):
    c = A["global"]["costs"]
    budget = sum(i["budget_inr"] for i in A["initiatives"])
    stipend = c["closer_stipend_inr"][level]
    fee = c["finder_fee_rate"]["value"] * float(df[df.id.isin(c["finder_fee_rate"]["applies_to"])].collected_inr.sum())
    return dict(budget_inr=budget, closer_stipend_inr=stipend, finder_fees_inr=fee, total_cost_inr=budget + stipend + fee,
                net_cash_after_costs_inr=t["collected_inr"] - budget - stipend - fee)


def collection_rate(p):
    if not p["collection_desk"]:
        return p["bau_collection"]
    return float(sum(m * q for m, q in zip(p["phase_mix"], p["phase_prob"])))


def expected(p):
    """Deterministic expected-value forecast with capacity-constrained proposal allocation."""
    cap = p["closers"] * p["proposals_per_closer"]
    rows = []
    for s in p["sources"]:
        conv = s["prospects"] * s["conv"]
        demand = conv * s["prop"]
        rows.append(dict(**s, conversations=conv, proposal_demand=demand, ev_per_proposal=s["win"] * s["deal"]))
    # fill capacity with the highest expected value per proposal first (warm before cold)
    left = cap
    for r in sorted(rows, key=lambda r: -r["ev_per_proposal"]):
        r["proposals"] = min(r["proposal_demand"], left)
        left -= r["proposals"]
    cr = collection_rate(p)
    for r in rows:
        r["signed"] = r["proposals"] * r["win"]
        r["committed_inr"] = r["signed"] * r["deal"]
        r["cash_type_inr"] = r["committed_inr"] * cs(p, r)
        r["in_kind_inr"] = r["committed_inr"] - r["cash_type_inr"]
        r["net_cash_inr"] = r["cash_type_inr"] * (1 - p["withdrawal"])
        r["upsell_net_cash_inr"] = r["signed"] * cs(p, r) * p["attach"] * p["addon"] * (1 - p["withdrawal"])
        r["collected_inr"] = (r["net_cash_inr"] + r["upsell_net_cash_inr"]) * cr
    df = pd.DataFrame(rows)
    tot = dict(
        capacity_proposals=cap, proposal_demand=df.proposal_demand.sum(), proposals=df.proposals.sum(),
        capacity_binding=bool(df.proposal_demand.sum() > cap + 1e-9),
        prospects=df.prospects.sum(), conversations=df.conversations.sum(), signed=df.signed.sum(),
        committed_inr=df.committed_inr.sum(), cash_type_inr=df.cash_type_inr.sum(), in_kind_inr=df.in_kind_inr.sum(),
        withdrawal_loss_inr=(df.cash_type_inr - df.net_cash_inr).sum(), net_cash_inr=df.net_cash_inr.sum(),
        upsell_net_cash_inr=df.upsell_net_cash_inr.sum(), collection_rate=cr,
        collected_inr=df.collected_inr.sum(),
    )
    tot["uncollected_by_festival_inr"] = tot["net_cash_inr"] + tot["upsell_net_cash_inr"] - tot["collected_inr"]
    return df, tot


def all_enabled():
    return {k for k, _ in STEPS if k != "BAU"}


def waterfall(level):
    rows, enabled = [], set()
    prev = None
    for k, label in STEPS:
        if k != "BAU":
            enabled.add(k)
        _, t = expected(resolve(level, enabled))
        rows.append(dict(step=k, label=label, collected_inr=t["collected_inr"], signed=t["signed"],
                         increment_inr=t["collected_inr"] - (prev if prev is not None else 0)))
        prev = t["collected_inr"]
    return pd.DataFrame(rows)


def monte_carlo(p, n=10000, seed=7, concentration=20.0):  # noqa: C901
    """Uncertainty: Beta-distributed rates (mean = assumption, concentration k), binomial deal counts,
    deal sizes bootstrapped from the 2025 cash-deal shape, per-deal withdrawal and collection draws."""
    rng = np.random.default_rng(seed)
    cap = p["closers"] * p["proposals_per_closer"]
    out = np.zeros(n)
    signed_out = np.zeros(n)
    srcs = sorted(p["sources"], key=lambda s: -s["win"] * s["deal"])

    def beta(m, size):
        if m <= 0: return np.zeros(size)
        if m >= 1: return np.ones(size)
        return rng.beta(m * concentration, (1 - m) * concentration, size)
    phase_mix = np.array(p["phase_mix"]); phase_prob = np.array(p["phase_prob"])
    for i in range(n):
        left = cap; total = 0.0; nsig = 0
        for s in srcs:
            if s["prospects"] <= 0: continue
            conv = rng.binomial(int(round(s["prospects"])), beta(s["conv"], 1)[0])
            props = min(rng.binomial(conv, beta(s["prop"], 1)[0]), int(left))
            left -= props
            k = rng.binomial(props, beta(s["win"], 1)[0])
            if k == 0: continue
            nsig += k
            vals = s["deal"] * rng.choice(DEAL_SHAPE, k)
            is_cash = rng.random(k) < cs(p, s)
            kept = rng.random(k) >= p["withdrawal"]
            addon = (rng.random(k) < p["attach"]) * p["addon"]
            due = (vals + addon) * is_cash * kept
            if p["collection_desk"]:
                ph = rng.choice(3, k, p=phase_mix)
                got = rng.random(k) < phase_prob[ph]
            else:
                got = rng.random(k) < p["bau_collection"]
            total += float((due * got).sum())
        out[i] = total; signed_out[i] = nsig
    return out, signed_out


def sensitivity(level):
    """One-at-a-time sensitivities on the full plan."""
    base_p = resolve(level, all_enabled())
    _, t0 = expected(base_p)
    tests = []

    def run(name, mut):
        p = copy.deepcopy(base_p); mut(p); _, t = expected(p)
        tests.append(dict(test=name, collected_inr=t["collected_inr"], delta_inr=t["collected_inr"] - t0["collected_inr"],
                          delta_pct=(t["collected_inr"] / t0["collected_inr"] - 1)))

    def scale_rate(key, f):
        def m(p):
            for s in p["sources"]: s[key] = min(1.0, s[key] * f)
        return m
    run("Collection probabilities -10 pp", lambda p: p.__setitem__("phase_prob", [max(0, x - 0.10) for x in p["phase_prob"]]))
    run("Collection desk absent (70% flat)", lambda p: p.__setitem__("collection_desk", False))
    run("Win rates x0.8 (all sources)", scale_rate("win", 0.8))
    run("Win rates x1.2 (all sources)", scale_rate("win", 1.2))
    run("Avg deal size -20%", lambda p: [s.__setitem__("deal", s["deal"] * 0.8) for s in p["sources"]])
    run("Avg deal size +20%", lambda p: [s.__setitem__("deal", s["deal"] * 1.2) for s in p["sources"]])
    run("Warm referral volume -30%", lambda p: [s.__setitem__("prospects", s["prospects"] * 0.7) for s in p["sources"] if s["id"] in ("alumni_referral", "creator_referral")])
    run("Cold win rate doubled", lambda p: [s.__setitem__("win", s["win"] * 2) for s in p["sources"] if s["id"] == "cold_outbound"])
    run("One fewer closer", lambda p: p.__setitem__("closers", p["closers"] - 1))
    run("One more closer", lambda p: p.__setitem__("closers", p["closers"] + 1))
    run("Late signings double (phase mix shifts late)", lambda p: p.__setitem__("phase_mix", [p["phase_mix"][0] - p["phase_mix"][2], p["phase_mix"][1], p["phase_mix"][2] * 2]))
    run("Renewals fail entirely", lambda p: [s.__setitem__("prospects", 0) for s in p["sources"] if s["id"] == "renewal"])
    run("Withdrawal rate 10%", lambda p: p.__setitem__("withdrawal", 0.10))
    return pd.DataFrame(tests)


def main():
    summary = {}
    for level in ["base", "stretch"]:
        p = resolve(level, all_enabled())
        df, t = expected(p)
        wf = waterfall(level)
        sims, ns = monte_carlo(p)
        _, bau = expected(resolve(level, set()))
        mc = dict(p10=float(np.percentile(sims, 10)), p50=float(np.percentile(sims, 50)), p90=float(np.percentile(sims, 90)),
                  mean=float(sims.mean()), signed_p10=float(np.percentile(ns, 10)), signed_p90=float(np.percentile(ns, 90)))
        summary[level] = dict(totals=t, monte_carlo=mc, bau_collected_inr=bau["collected_inr"], costs=costs(level, t, df),
                              by_source=df[["id", "name", "initiative", "prospects", "conversations", "proposal_demand", "proposals",
                                            "signed", "committed_inr", "cash_type_inr", "in_kind_inr", "net_cash_inr",
                                            "upsell_net_cash_inr", "collected_inr"]].to_dict("records"),
                              waterfall=wf.to_dict("records"))
        df.to_csv(OUT / f"forecast_{level}_by_source.csv", index=False)
        wf.to_csv(OUT / f"waterfall_{level}.csv", index=False)
        sensitivity(level).to_csv(OUT / f"sensitivity_{level}.csv", index=False)
    # target probability: chance the base plan reaches the base target, and stretch plan reaches stretch target
    for level in ["base", "stretch"]:
        sims, _ = monte_carlo(resolve(level, all_enabled()))
        tgt = summary[level]["totals"]["collected_inr"]
        summary[level]["monte_carlo"]["p_reach_expected"] = float((sims >= tgt).mean())
        summary[level]["monte_carlo"]["p_reach_base_target"] = float((sims >= summary["base"]["totals"]["collected_inr"]).mean())
        summary[level]["monte_carlo"]["p_reach_2025_cash_type"] = float((sims >= 2_000_000).mean())
    # downside case: base plan under simultaneous stress (overrides in assumptions.json)
    dn = A["downside"]
    pd_ = apply_overrides(resolve(dn["level"], all_enabled()), dn["overrides"])
    ddf, dt = expected(pd_)
    dmc, _ = monte_carlo(pd_)
    summary["downside"] = dict(overrides=dn["overrides"], totals=dt, costs=costs(dn["level"], dt, ddf),
                               monte_carlo=dict(p10=float(np.percentile(dmc, 10)), p50=float(np.percentile(dmc, 50)), p90=float(np.percentile(dmc, 90)), mean=float(dmc.mean())))
    # Monte Carlo band sensitivity to the assumed rate-uncertainty concentration k
    summary["mc_band_sensitivity"] = {}
    for k in (10, 20, 40):
        sims, _ = monte_carlo(resolve("base", all_enabled()), n=5000, concentration=float(k))
        summary["mc_band_sensitivity"][f"k={k}"] = dict(p10=float(np.percentile(sims, 10)), p90=float(np.percentile(sims, 90)))
    # budget
    summary["budget_inr"] = sum(i["budget_inr"] for i in A["initiatives"])
    summary["initiatives"] = A["initiatives"]
    (OUT / "forecast_summary.json").write_text(json.dumps(summary, indent=2, default=float), encoding="utf-8")

    for level in ["base", "stretch"]:
        s = summary[level]; t = s["totals"]
        print(f"\n===== {level.upper()} =====")
        print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in t.items()})
        print("MC", {k: round(v, 3) for k, v in s["monte_carlo"].items()})
        print("BAU collected", round(s["bau_collected_inr"]))
        print(pd.DataFrame(s["waterfall"]).round(1).to_string())
        print(pd.DataFrame(s["by_source"])[["id", "proposal_demand", "proposals", "signed", "committed_inr", "collected_inr"]].round(1).to_string())
    print("\nSensitivity base"); print(pd.read_csv(OUT / "sensitivity_base.csv").round(3).to_string())
    print("budget", summary["budget_inr"])
    for k in ("base", "stretch"): print(k, "costs", {a: round(b) for a, b in summary[k]["costs"].items()})
    print("downside collected", round(summary["downside"]["totals"]["collected_inr"]), "MC", {a: round(b) for a, b in summary["downside"]["monte_carlo"].items()})
    print("MC band vs k", {k: (round(v["p10"]), round(v["p90"])) for k, v in summary["mc_band_sensitivity"].items()})


if __name__ == "__main__":
    main()

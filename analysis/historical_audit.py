"""
CampusFest 2025 — Independent historical audit of Sponsor_Dataset.xlsx  (Challenge B)

Reproducible source -> metric pipeline. Run:
    python analysis/historical_audit.py

Rules implemented (from the workbook's own 'Read me' sheet):
  * Each selected date = end of that day, Asia/Kolkata (all timestamps are IST-naive in the workbook).
  * Identical rows repeated with the same stable ID are import retries -> dropped.
    Same ID with a DIFFERENT payload would be a conflict -> reported, never silently dropped.
  * History tables are full-state: take latest version <= cutoff per entity. Never sum history rows.
  * Joins on stable IDs only (never names).
  * Brands, contacts, attempts, opportunities are different populations and are counted separately.
  * Confirmed value is NOT cash; in-kind is NOT cash; no receipt ledger exists.

Outputs -> outputs/audit/
"""
from __future__ import annotations
import json, hashlib
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source_documents" / "Sponsor_Dataset.xlsx"
OUT = ROOT / "outputs" / "audit"
OUT.mkdir(parents=True, exist_ok=True)

CUTOFFS = {
    "pre_festival": pd.Timestamp("2025-04-11 23:59:59"),   # primary objective snapshot
    "festival_end": pd.Timestamp("2025-04-13 23:59:59"),
    "history_end": pd.Timestamp("2025-04-20 23:59:59"),
}
PRIMARY = "pre_festival"

SHEET_KEYS = {
    "Brands": "brand_id",
    "Sponsor contacts": "contact_id",
    "Sponsor campaigns": "sponsor_campaign_id",
    "Sponsor interactions": "interaction_id",
    "Brand qualification": "history_id",
    "Partner opportunities": "opportunity_id",
    "Opportunity history": "history_id",
    "Sponsor activations": "activation_id",
}

dq_rows: list[dict] = []


def dq(check: str, result: str, count, detail: str = ""):
    dq_rows.append({"check": check, "result": result, "count": count, "detail": detail})


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# --------------------------------------------------------------------------- load + dedupe
def load():
    raw = pd.read_excel(SRC, sheet_name=None)
    clean = {}
    for sheet, df in raw.items():
        if sheet not in SHEET_KEYS:
            clean[sheet] = df
            continue
        key = SHEET_KEYS[sheet]
        n0 = len(df)
        dup_id_rows = df[df[key].duplicated(keep=False)]
        exact = df.duplicated(keep="first")
        conflicts = dup_id_rows.drop_duplicates()
        conflicts = conflicts[conflicts[key].duplicated(keep=False)]
        dq(f"{sheet}: rows read", "info", n0)
        dq(f"{sheet}: exact duplicate rows (import retries) removed", "info", int(exact.sum()),
           ", ".join(sorted(df.loc[exact, key].astype(str))))
        dq(f"{sheet}: same ID with conflicting payload", "PASS" if conflicts.empty else "FAIL",
           int(conflicts[key].nunique()), ", ".join(sorted(conflicts[key].astype(str).unique())))
        d = df.drop_duplicates().reset_index(drop=True)
        dq(f"{sheet}: unique {key} after dedupe", "PASS" if d[key].is_unique else "FAIL", int(d[key].nunique()))
        clean[sheet] = d
    return raw, clean


# --------------------------------------------------------------------------- integrity
def integrity(c):
    br, ct, sc = c["Brands"], c["Sponsor contacts"], c["Sponsor campaigns"]
    si, bq, op, oh, act = (c["Sponsor interactions"], c["Brand qualification"], c["Partner opportunities"],
                           c["Opportunity history"], c["Sponsor activations"])
    def fk(name, child, col, parent, pcol):
        vals = child[col].dropna()
        missing = sorted(set(vals) - set(parent[pcol]))
        dq(f"FK {name}.{col} -> {pcol}", "PASS" if not missing else "FAIL", len(missing), ", ".join(map(str, missing[:20])))
    fk("contacts", ct, "brand_id", br, "brand_id")
    fk("interactions", si, "brand_id", br, "brand_id")
    fk("interactions", si, "contact_id", ct, "contact_id")
    fk("interactions", si, "sponsor_campaign_id", sc, "sponsor_campaign_id")
    fk("qualification", bq, "brand_id", br, "brand_id")
    fk("opportunities", op, "brand_id", br, "brand_id")
    fk("opportunities", op, "primary_contact_id", ct, "contact_id")
    fk("opportunities", op, "sponsor_campaign_id", sc, "sponsor_campaign_id")
    fk("opp_history", oh, "opportunity_id", op, "opportunity_id")
    fk("activations", act, "opportunity_id", op, "opportunity_id")
    # interaction contact belongs to interaction brand
    m = si.merge(ct[["contact_id", "brand_id"]], on="contact_id", suffixes=("", "_ct"))
    bad = m[m.brand_id != m.brand_id_ct]
    dq("Interaction contact belongs to same brand", "PASS" if bad.empty else "FAIL", len(bad))
    # opp history brand matches opp brand
    m = oh.merge(op[["opportunity_id", "brand_id"]], on="opportunity_id", suffixes=("", "_op"))
    bad = m[m.brand_id != m.brand_id_op]
    dq("Opportunity history brand = opportunity brand", "PASS" if bad.empty else "FAIL", len(bad))
    # origin pointers resolve and share attempt
    roots = si[si.origin_interaction_id.isna()]
    kids = si[si.origin_interaction_id.notna()]
    missing = set(kids.origin_interaction_id) - set(si.interaction_id)
    dq("origin_interaction_id resolves to an interaction", "PASS" if not missing else "FAIL", len(missing))
    k2 = kids.merge(si[["interaction_id", "attempt_id"]], left_on="origin_interaction_id",
                    right_on="interaction_id", suffixes=("", "_root"))
    bad = k2[k2.attempt_id != k2.attempt_id_root]
    dq("Follow-on events share root attempt_id", "PASS" if bad.empty else "FAIL", len(bad))
    per_attempt = roots.groupby("attempt_id").size()
    dq("Exactly one root event per attempt", "PASS" if (per_attempt == 1).all() else "FAIL", int((per_attempt != 1).sum()))
    dq("Root event types", "info", len(roots), roots.event_type.value_counts().to_dict().__repr__())
    # timestamp ties within full-state histories (would make 'latest' ambiguous)
    for name, h, k in [("Opportunity history", oh, "opportunity_id"), ("Brand qualification", bq, "brand_id")]:
        ties = (h.groupby([k, "effective_at"]).size() > 1).sum()
        dq(f"{name}: ambiguous same-timestamp versions", "PASS" if ties == 0 else "WARN", int(ties))
    # confirmed value rule
    bad = oh[(oh.stage != "partner_confirmed") & (oh.confirmed_value_inr != 0)]
    dq("confirmed_value_inr = 0 unless stage partner_confirmed", "PASS" if bad.empty else "FAIL", len(bad))
    conf = oh[oh.stage == "partner_confirmed"]
    diff = conf[conf.confirmed_value_inr != conf.proposed_value_inr]
    dq("Confirmed value differs from proposed value (confirmed rows)", "info", len(diff),
       "all confirmed versions carry confirmed = proposed" if diff.empty else ", ".join(diff.opportunity_id))
    # opportunity created_at vs first history
    first = oh.groupby("opportunity_id").effective_at.min().rename("first_hist")
    m = op.set_index("opportunity_id").join(first)
    bad = m[m.first_hist < m.created_at]
    dq("Opportunity history begins before opportunity created_at", "PASS" if bad.empty else "WARN", len(bad))
    dq("Receipt / payment / invoice records present in source", "LIMITATION", 0,
       "No sheet records bank receipts, invoices or payment dates. Historical cash collected is UNKNOWN.")
    dq("Campaign spend records present in source", "LIMITATION", 0,
       "Sponsor campaigns sheet has no budget or spend columns. Historical CAC/ROI cannot be calculated.")


# --------------------------------------------------------------------------- snapshot
def latest(h: pd.DataFrame, key: str, cut) -> pd.DataFrame:
    h = h[h.effective_at <= cut]
    return h.sort_values([key, "effective_at", "history_id"]).groupby(key, as_index=False).tail(1)


def snapshot(c, cut, label):
    br, ct, sc = c["Brands"], c["Sponsor contacts"], c["Sponsor campaigns"]
    si, bq, op, oh = (c["Sponsor interactions"], c["Brand qualification"], c["Partner opportunities"], c["Opportunity history"])
    tg = c["Targets"]
    si = si[si.occurred_at <= cut]
    roots = si[si.origin_interaction_id.isna()]
    replied = si[si.event_type == "replied"]
    pos = replied[replied.outcome == "positive"]
    met = si[si.event_type == "meeting_held"]
    booked = si[si.event_type == "meeting_booked"]
    optout = si[si.event_type == "opt_out"]
    q = latest(bq, "brand_id", cut)
    o_hist = latest(oh, "opportunity_id", cut)
    o = op[op.created_at <= cut].merge(o_hist.drop(columns=["opportunity_name", "brand_name", "brand_id"]),
                                       on="opportunity_id", how="left")
    o["stage"] = o["stage"].fillna("no_history_yet")
    cash = o.support_type == "cash"
    confirmed = o.stage == "partner_confirmed"
    open_stages = ["prospecting", "contacted", "proposal_sent", "negotiating"]
    is_open = o.stage.isin(open_stages)
    target = tg[tg.effective_at <= cut].sort_values("effective_at").tail(1).iloc[0]

    K = []  # (metric, value, numerator, denominator, unit, definition, label)

    def k(metric, value, unit="count", definition="", num=None, den=None, lab="[CALCULATED]"):
        K.append(dict(snapshot=label, cutoff=str(cut), metric=metric, value=value, unit=unit, numerator=num,
                      denominator=den, definition=definition, label=lab))

    def rate(metric, num, den, definition):
        k(metric, round(num / den, 4) if den else None, "ratio", definition, num, den)

    k("brands_in_source", br.brand_id.nunique(), definition="Distinct brand_id in Brands (static, created_at may postdate cutoff)", lab="[SOURCE]")
    k("brands_created_by_cutoff", int((br.created_at <= cut).sum()), definition="brand created_at <= cutoff")
    k("contacts_created_by_cutoff", int((ct.created_at <= cut).sum()), definition="contact created_at <= cutoff")
    k("campaigns", sc.sponsor_campaign_id.nunique(), definition="Distinct sponsor_campaign_id", lab="[SOURCE]")
    k("interaction_events", len(si), definition="Deduplicated interaction rows with occurred_at <= cutoff")
    k("unique_attempts", roots.attempt_id.nunique(), definition="Distinct attempt_id whose root event (no origin_interaction_id) occurred <= cutoff")
    k("outbound_attempts", int((roots.event_type == "outreach_sent").sum()), definition="Root events of type outreach_sent")
    k("introductions_received", int((roots.event_type == "introduction_received").sum()), definition="Root events of type introduction_received")
    k("web_inbound_submissions", int((roots.event_type == "web_inbound").sum()), definition="Root events of type web_inbound")
    touched = roots.brand_id.nunique()
    k("brands_touched", touched, definition="Distinct brands with >=1 root touch (outbound, intro or inbound) <= cutoff")
    k("brands_outbound_contacted", roots[roots.event_type == "outreach_sent"].brand_id.nunique(), definition="Distinct brands with >=1 outreach_sent")
    k("contacts_touched", roots.contact_id.nunique(), definition="Distinct contacts with >=1 root touch")
    delivered = si[si.event_type == "delivered"].attempt_id.nunique()
    out_att = int((roots.event_type == "outreach_sent").sum())
    rate("delivery_rate", delivered, out_att, "attempts with delivered event / outbound attempts")
    k("brands_replied", replied.brand_id.nunique(), definition="Distinct brands with any 'replied' event")
    k("brands_positive_reply", pos.brand_id.nunique(), definition="Distinct brands with replied/positive")
    rate("brand_reply_rate", replied.brand_id.nunique(), roots[roots.event_type == "outreach_sent"].brand_id.nunique(),
         "brands replied / brands outbound-contacted (note: replies can also follow intros)")
    k("meetings_booked", len(booked), definition="meeting_booked events")
    k("meetings_held", len(met), definition="meeting_held events")
    k("brands_met", met.brand_id.nunique(), definition="Distinct brands with >=1 meeting_held")
    k("opt_out_brands", optout.brand_id.nunique(), definition="Distinct brands with opt_out (do_not_contact) — suppress from outreach")
    qs = q.qualification_status.value_counts()
    for s in ["unreviewed", "engaged", "qualified", "unqualified", "dormant"]:
        k(f"brands_{s}", int(qs.get(s, 0)), definition=f"Brands whose latest qualification version <= cutoff is '{s}'")
    k("qualified_brands_goal", int(target.qualified_brands_goal), definition=f"Targets version '{target.target_version}'", lab="[SOURCE]")
    k("confirmed_partnerships_goal", int(target.confirmed_partnerships_goal), definition=f"Targets version '{target.target_version}'", lab="[SOURCE]")
    rate("qualified_vs_goal", int(qs.get("qualified", 0)), int(target.qualified_brands_goal), "qualified brands / goal")
    rate("confirmed_vs_goal", int(confirmed.sum()), int(target.confirmed_partnerships_goal), "confirmed opportunities / goal")
    k("opportunities", len(o), definition="Opportunities with created_at <= cutoff")
    k("brands_with_opportunity", o.brand_id.nunique(), definition="Distinct brands with >=1 opportunity")
    for s in open_stages + ["partner_confirmed", "lost", "withdrawn"]:
        sel = o.stage == s
        k(f"opps_{s}", int(sel.sum()), definition=f"Opportunities whose latest stage <= cutoff is {s}")
        k(f"proposed_inr_{s}", int(o.loc[sel, "proposed_value_inr"].fillna(0).sum()), "INR", f"Sum latest proposed_value_inr, stage {s} (face value; not cash)")
    k("open_opportunities", int(is_open.sum()), definition="prospecting+contacted+proposal_sent+negotiating")
    k("open_pipeline_proposed_inr", int(o.loc[is_open, "proposed_value_inr"].sum()), "INR", "Face value of open opportunities")
    k("open_pipeline_cash_proposed_inr", int(o.loc[is_open & cash, "proposed_value_inr"].sum()), "INR", "Face value of open cash-type opportunities")
    k("confirmed_opportunities", int(confirmed.sum()), definition="Latest stage partner_confirmed")
    k("confirmed_brands", o.loc[confirmed, "brand_id"].nunique(), definition="Distinct brands with a confirmed opportunity")
    k("confirmed_value_inr_total", int(o.loc[confirmed, "confirmed_value_inr"].sum()), "INR", "Sum confirmed_value_inr (cash-type + in-kind). NOT cash collected")
    k("confirmed_cash_type_inr", int(o.loc[confirmed & cash, "confirmed_value_inr"].sum()), "INR", "Confirmed value where support_type=cash. A commitment, NOT a receipt")
    k("confirmed_in_kind_inr", int(o.loc[confirmed & ~cash, "confirmed_value_inr"].sum()), "INR", "Confirmed value where support_type=in_kind. Never counted as cash")
    k("confirmed_cash_type_count", int((confirmed & cash).sum()), definition="Confirmed cash-type opportunities")
    k("confirmed_in_kind_count", int((confirmed & ~cash).sum()), definition="Confirmed in-kind opportunities")
    cv = o.loc[confirmed & cash, "confirmed_value_inr"]
    k("avg_confirmed_cash_deal_inr", int(round(cv.mean())) if len(cv) else None, "INR", "Mean confirmed cash-type value")
    k("median_confirmed_cash_deal_inr", int(cv.median()) if len(cv) else None, "INR", "Median confirmed cash-type value")
    k("cash_received_inr", None, "INR", "UNKNOWN — source contains no receipt ledger", lab="[UNKNOWN]")
    closed = o.stage.isin(["partner_confirmed", "lost", "withdrawn"])
    rate("win_rate_closed", int(confirmed.sum()), int(closed.sum()), "confirmed / (confirmed+lost+withdrawn)")
    rate("opp_to_confirmed", int(confirmed.sum()), len(o), "confirmed / all opportunities created")
    rate("qualified_to_opportunity_brands", o.brand_id.nunique(), int(qs.get("qualified", 0)), "brands with opp / qualified brands (brands can have opp without qualified status — see anomalies)")
    # stage reach (ever reached, by cutoff)
    hist = oh[oh.effective_at <= cut]
    order = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed"]
    reached = {s: hist[hist.stage == s].opportunity_id.nunique() for s in order}
    for a, b in zip(order, order[1:]):
        rate(f"stage_conv_{a}_to_{b}", reached[b], reached[a], f"opps ever reaching {b} / ever reaching {a} (by cutoff)")
    for s in order:
        k(f"opps_ever_reached_{s}", reached[s], definition=f"Opportunities with any version at stage {s} <= cutoff")
    # cycle time
    first_conf = hist[hist.stage == "partner_confirmed"].groupby("opportunity_id").effective_at.min()
    created = op.set_index("opportunity_id").created_at
    ct_days = (first_conf - created.reindex(first_conf.index)).dt.total_seconds() / 86400
    k("median_days_created_to_confirmed", round(float(ct_days.median()), 1) if len(ct_days) else None, "days", "Median(first partner_confirmed effective_at - created_at)")
    k("mean_days_created_to_confirmed", round(float(ct_days.mean()), 1) if len(ct_days) else None, "days", "Mean of the same")
    age = (cut - o.loc[is_open, "effective_at"]).dt.total_seconds() / 86400
    k("open_median_days_in_current_stage", round(float(age.median()), 1) if len(age) else None, "days", "Median days since last stage version, open opps")
    k("open_opps_stale_14d", int((age > 14).sum()), definition="Open opps whose current stage version is older than 14 days")
    return pd.DataFrame(K), o, q, si


# --------------------------------------------------------------------------- campaign reconciliation
def campaigns(c, cut, o, q, si):
    sc = c["Sponsor campaigns"]
    roots = si[si.origin_interaction_id.isna()]
    rows = []
    for _, r in sc.iterrows():
        cid = r.sponsor_campaign_id
        s = si[si.sponsor_campaign_id == cid]
        rt = roots[roots.sponsor_campaign_id == cid]
        oc = o[o.sponsor_campaign_id == cid]
        conf = oc[oc.stage == "partner_confirmed"]
        qq = q[q.sponsor_campaign_id == cid]
        attempts = rt.attempt_id.nunique()
        brands = rt.brand_id.nunique()
        rows.append(dict(
            sponsor_campaign_id=cid, campaign_name=r.campaign_name, channel=r.channel, owner=r.owner_name,
            attempts=attempts, brands_touched=brands,
            delivered=int((s.event_type == "delivered").sum()),
            brands_replied=s[s.event_type == "replied"].brand_id.nunique(),
            brands_positive=s[(s.event_type == "replied") & (s.outcome == "positive")].brand_id.nunique(),
            meetings_held=int((s.event_type == "meeting_held").sum()),
            opt_outs=int((s.event_type == "opt_out").sum()),
            brands_latest_qualified_by_source=int((qq.qualification_status == "qualified").sum()),
            opportunities_originated=len(oc),
            confirmed=len(conf),
            confirmed_cash_type_inr=int(conf[conf.support_type == "cash"].confirmed_value_inr.sum()),
            confirmed_in_kind_inr=int(conf[conf.support_type != "cash"].confirmed_value_inr.sum()),
            open_pipeline_inr=int(oc[oc.stage.isin(["prospecting", "contacted", "proposal_sent", "negotiating"])].proposed_value_inr.sum()),
            lost_or_withdrawn=int(oc.stage.isin(["lost", "withdrawn"]).sum()),
            meeting_rate_per_brand=round((s[s.event_type == "meeting_held"].brand_id.nunique()) / brands, 4) if brands else None,
            confirmed_per_brand_touched=round(len(conf) / brands, 4) if brands else None,
            spend_inr="UNKNOWN (no spend data)", roi="NOT CALCULABLE",
        ))
    df = pd.DataFrame(rows)
    tot = df.select_dtypes("number").sum()
    dq("Campaign reconciliation: Σ campaign confirmed = total confirmed opps", "PASS" if tot.confirmed == int((o.stage == "partner_confirmed").sum()) else "FAIL", int(tot.confirmed))
    dq("Campaign reconciliation: Σ campaign attempts = unique attempts", "PASS" if tot.attempts == roots.attempt_id.nunique() else "FAIL", int(tot.attempts))
    dq("Campaign reconciliation: Σ originated opps = opportunities", "PASS" if tot.opportunities_originated == len(o) else "FAIL", int(tot.opportunities_originated))
    return df


# --------------------------------------------------------------------------- opportunity reconciliation + anomalies
def opp_recon(c, snaps):
    op, oh, bq, si, act = (c["Partner opportunities"], c["Opportunity history"], c["Brand qualification"],
                           c["Sponsor interactions"], c["Sponsor activations"])
    pre = snaps[PRIMARY]; end = snaps["history_end"]
    cut = CUTOFFS[PRIMARY]
    paths = oh.sort_values(["opportunity_id", "effective_at"]).groupby("opportunity_id").stage.agg(">".join)
    met_at = si[si.event_type == "meeting_held"].groupby("brand_id").occurred_at.min()
    q_first = bq[bq.qualification_status == "qualified"].groupby("brand_id").effective_at.min()
    qlatest = latest(bq, "brand_id", cut).set_index("brand_id").qualification_status
    opp_per_brand = op.groupby("brand_id").size()
    rows = []
    for _, r in op.iterrows():
        oid, bid = r.opportunity_id, r.brand_id
        a = pre[0].set_index("opportunity_id").loc[oid] if oid in set(pre[0].opportunity_id) else None
        b = end[0].set_index("opportunity_id").loc[oid]
        h = oh[oh.opportunity_id == oid]
        flags = []
        if "partner_confirmed>withdrawn" in paths[oid]: flags.append("confirmed_then_withdrawn")
        if bid not in met_at.index: flags.append("no_meeting_held_for_brand")
        elif met_at[bid] > cut: flags.append("meeting_after_cutoff")
        qf = q_first.get(bid)
        if qf is None: flags.append("brand_never_qualified")
        elif qf > r.created_at: flags.append("opportunity_created_before_brand_qualified")
        if opp_per_brand[bid] > 1: flags.append("multiple_opportunities_for_brand")
        if qlatest.get(bid) != "qualified" and a is not None and a.stage == "partner_confirmed":
            flags.append(f"confirmed_but_brand_latest_status_{qlatest.get(bid)}")
        if h.proposed_value_inr.nunique() > 1: flags.append("proposed_value_changed")
        rows.append(dict(
            opportunity_id=oid, opportunity_name=r.opportunity_name, brand_id=bid, brand_name=r.brand_name,
            support_type=r.support_type, originating_campaign=r.originating_campaign_name, sponsor_campaign_id=r.sponsor_campaign_id,
            created_at=r.created_at, history_versions=len(h), stage_path=paths[oid],
            stage_pre_festival=None if a is None else a.stage,
            proposed_inr_pre_festival=None if a is None else int(a.proposed_value_inr),
            confirmed_inr_pre_festival=None if a is None else int(a.confirmed_value_inr),
            stage_last_change_pre_festival=None if a is None else a.effective_at,
            owner_pre_festival=None if a is None else a.owner_name,
            stage_history_end=b.stage, confirmed_inr_history_end=int(b.confirmed_value_inr),
            cash_type_confirmed_inr_pre_festival=int(a.confirmed_value_inr) if (a is not None and a.stage == "partner_confirmed" and r.support_type == "cash") else 0,
            in_kind_confirmed_inr_pre_festival=int(a.confirmed_value_inr) if (a is not None and a.stage == "partner_confirmed" and r.support_type != "cash") else 0,
            brand_latest_qualification_pre_festival=qlatest.get(bid),
            first_meeting_held_at=met_at.get(bid), first_qualified_at=qf,
            has_activation=oid in set(act.opportunity_id),
            cash_received_inr="UNKNOWN", anomaly_flags=";".join(flags),
        ))
    df = pd.DataFrame(rows).sort_values("opportunity_id")
    for f in ["confirmed_then_withdrawn", "no_meeting_held_for_brand", "brand_never_qualified",
              "opportunity_created_before_brand_qualified", "multiple_opportunities_for_brand", "proposed_value_changed"]:
        sel = df[df.anomaly_flags.str.contains(f)]
        dq(f"Anomaly: {f}", "INVESTIGATE" if len(sel) else "PASS", len(sel), ", ".join(sel.opportunity_id))
    cf = df[df.anomaly_flags.str.contains("confirmed_but_brand_latest_status")]
    dq("Anomaly: confirmed opp whose brand's latest qualification is not 'qualified'", "INVESTIGATE" if len(cf) else "PASS", len(cf),
       "; ".join(f"{a}:{b}" for a, b in zip(cf.opportunity_id, cf.brand_latest_qualification_pre_festival)))
    # snapshot diff
    chg = df[df.stage_pre_festival != df.stage_history_end]
    dq("Opportunity stage changes between pre-festival and history-end", "info", len(chg), ", ".join(chg.opportunity_id))
    # qualified brands without opportunity
    qb = set(qlatest[qlatest == "qualified"].index)
    no_opp = sorted(qb - set(op.brand_id))
    dq("Anomaly: brands latest 'qualified' with no opportunity (pre-festival)", "INVESTIGATE" if no_opp else "PASS", len(no_opp), ", ".join(no_opp))
    # opt-out brands with open or confirmed opps
    oo = set(si[si.event_type == "opt_out"].brand_id)
    ooo = df[df.brand_id.isin(oo)]
    dq("Opt-out brands that also have an opportunity", "INVESTIGATE" if len(ooo) else "PASS", len(ooo),
       ", ".join(f"{a}({b})" for a, b in zip(ooo.opportunity_id, ooo.stage_pre_festival)))
    # synthetic patterns
    conf = df[df.stage_pre_festival == "partner_confirmed"]
    prefix = conf.brand_name.str.split().str[0].value_counts()
    dq("Synthetic pattern: confirmed brands by name prefix", "info", len(conf), prefix.to_dict().__repr__())
    dq("Synthetic pattern: confirmed opportunities whose path skipped no stage", "info",
       int(conf.stage_path.str.startswith("prospecting>contacted>proposal_sent>negotiating>partner_confirmed").sum()),
       "every confirmed deal passed through all four stages in order")
    return df


# --------------------------------------------------------------------------- owner / industry
def breakdowns(c, o, q, si, cut):
    br = c["Brands"]
    roots = si[si.origin_interaction_id.isna()]
    ob = o.merge(br[["brand_id", "industry"]], on="brand_id")
    def agg(g):
        conf = g[g.stage == "partner_confirmed"]
        return pd.Series(dict(opportunities=len(g), confirmed=len(conf),
                              confirmed_cash_type_inr=int(conf[conf.support_type == "cash"].confirmed_value_inr.sum()),
                              confirmed_in_kind_inr=int(conf[conf.support_type != "cash"].confirmed_value_inr.sum()),
                              open=int(g.stage.isin(["prospecting", "contacted", "proposal_sent", "negotiating"]).sum()),
                              lost_withdrawn=int(g.stage.isin(["lost", "withdrawn"]).sum())))
    ind = ob.groupby("industry").apply(agg, include_groups=False).reset_index()
    ind = ind.merge(br.groupby("industry").size().rename("brands").reset_index(), on="industry", how="right").fillna(0)
    ind = ind.merge(roots.merge(br[["brand_id", "industry"]], on="brand_id").groupby("industry").brand_id.nunique().rename("brands_touched").reset_index(), on="industry", how="left").fillna(0)
    own = o.groupby("owner_name").apply(agg, include_groups=False).reset_index().rename(columns={"owner_name": "opportunity_owner"})
    return ind, own


# --------------------------------------------------------------------------- main
def main():
    raw, c = load()
    integrity(c)
    snaps = {}
    kpis = []
    for lab, cut in CUTOFFS.items():
        K, o, q, si = snapshot(c, cut, lab)
        snaps[lab] = (o, q, si)
        kpis.append(K)
    kpi = pd.concat(kpis)
    o, q, si = snaps[PRIMARY]
    camp = campaigns(c, CUTOFFS[PRIMARY], o, q, si)
    recon = opp_recon(c, snaps)
    ind, own = breakdowns(c, o, q, si, CUTOFFS[PRIMARY])
    # leakage test: pre-festival snapshot must not contain any record after cutoff
    leaks = int((si.occurred_at > CUTOFFS[PRIMARY]).sum()) + int((o.effective_at > CUTOFFS[PRIMARY]).sum())
    dq("Leakage: pre-festival snapshot contains post-cutoff records", "PASS" if leaks == 0 else "FAIL", leaks)
    post = c["Sponsor interactions"][c["Sponsor interactions"].occurred_at > CUTOFFS[PRIMARY]]
    dq("Records after pre-festival cutoff excluded (interactions)", "info", len(post), ", ".join(post.interaction_id))
    postq = c["Brand qualification"][c["Brand qualification"].effective_at > CUTOFFS[PRIMARY]]
    dq("Records after pre-festival cutoff excluded (qualification versions)", "info", len(postq), postq.qualification_status.value_counts().to_dict().__repr__())

    kpi.to_csv(OUT / "historical_kpis.csv", index=False)
    camp.to_csv(OUT / "campaign_reconciliation.csv", index=False)
    recon.to_csv(OUT / "opportunity_reconciliation.csv", index=False)
    ind.to_csv(OUT / "industry_breakdown.csv", index=False)
    own.to_csv(OUT / "owner_breakdown.csv", index=False)
    pd.DataFrame(dq_rows).to_csv(OUT / "data_quality_report.csv", index=False)
    pre = kpi[kpi.snapshot == PRIMARY].set_index("metric").value
    snapshot_json = {
        "source_file": str(SRC.relative_to(ROOT)), "source_sha256": sha256(SRC),
        "cutoffs": {k: str(v) for k, v in CUTOFFS.items()},
        "pre_festival": {k: (None if pd.isna(v) else (float(v) if isinstance(v, (float, np.floating)) else v)) for k, v in pre.items()},
        "history_end": {k: (None if pd.isna(v) else (float(v) if isinstance(v, (float, np.floating)) else v))
                        for k, v in kpi[kpi.snapshot == "history_end"].set_index("metric").value.items()},
    }
    (OUT / "audit_snapshot.json").write_text(json.dumps(snapshot_json, indent=2, default=lambda x: int(x) if isinstance(x, np.integer) else str(x)))
    print(pd.DataFrame(dq_rows).to_string(max_colwidth=110))
    print(kpi[kpi.snapshot == PRIMARY][["metric", "value", "numerator", "denominator"]].to_string())
    print(camp.drop(columns=["spend_inr", "roi"]).to_string())


if __name__ == "__main__":
    main()

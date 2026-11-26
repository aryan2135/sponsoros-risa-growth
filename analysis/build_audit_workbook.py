"""
Builds outputs/audit/Source_Audit_Workbook.xlsx: cleaned pre-festival snapshot tables + KPI sheet whose
values are LIVE EXCEL FORMULAS (COUNTIFS/SUMIFS/SUMPRODUCT) next to the Python audit value, with a check column.
Then recalculates the workbook with the independent `formulas` engine and writes the validation result.

Run after historical_audit.py:  python analysis/build_audit_workbook.py
"""
from pathlib import Path
import json
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "audit"
SRC = ROOT / "source_documents" / "Sponsor_Dataset.xlsx"
CUT = pd.Timestamp("2025-04-11 23:59:59")

x = pd.read_excel(SRC, sheet_name=None)
si = x["Sponsor interactions"].drop_duplicates()
bq = x["Brand qualification"].drop_duplicates()
oh = x["Opportunity history"].drop_duplicates()
op = x["Partner opportunities"]
sc = x["Sponsor campaigns"]
kpi = pd.read_csv(OUT / "historical_kpis.csv")
py = kpi[kpi.snapshot == "pre_festival"].set_index("metric").value

# ---- cleaned, cutoff-applied tables (one row per entity / event) ----
ix = si[si.occurred_at <= CUT].copy()
ix["is_root"] = ix.origin_interaction_id.isna().map(int)
ix = ix[["interaction_id", "attempt_id", "is_root", "event_type", "outcome", "brand_id", "contact_id", "sponsor_campaign_id", "occurred_at"]]
ql = bq[bq.effective_at <= CUT].sort_values(["brand_id", "effective_at", "history_id"]).groupby("brand_id").tail(1)[["brand_id", "brand_name", "qualification_status", "sponsor_campaign_id", "effective_at", "history_id"]]
ol = oh[oh.effective_at <= CUT].sort_values(["opportunity_id", "effective_at", "history_id"]).groupby("opportunity_id").tail(1)
ol = op[["opportunity_id", "opportunity_name", "brand_id", "support_type", "sponsor_campaign_id", "created_at"]].merge(ol[["opportunity_id", "stage", "proposed_value_inr", "confirmed_value_inr", "owner_name", "effective_at", "history_id"]], on="opportunity_id")
ol = ol[ol.created_at <= CUT]
reach = oh[oh.effective_at <= CUT].groupby(["opportunity_id", "stage"]).size().unstack(fill_value=0).clip(upper=1).reset_index()
for s in ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed"]:
    if s not in reach: reach[s] = 0
reach = reach[["opportunity_id", "prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed"]]

wb = Workbook()
H = Font(bold=True, color="FFFFFF"); HF = PatternFill("solid", fgColor="0B1F3A")
def sheet(name, df):
    ws = wb.create_sheet(name)
    ws.append(list(df.columns))
    for r in df.itertuples(index=False):
        ws.append([v.to_pydatetime() if isinstance(v, pd.Timestamp) else (None if pd.isna(v) else v) for v in r])
    for c in ws[1]: c.font = H; c.fill = HF
    for i, col in enumerate(df.columns, 1): ws.column_dimensions[get_column_letter(i)].width = max(12, min(40, len(col) + 4))
    ws.freeze_panes = "A2"
    return ws, len(df) + 1

readme = wb.active; readme.title = "README"
lines = [
    "CampusFest 2025 sponsorship — Source audit workbook (Challenge B)",
    f"Source: source_documents/Sponsor_Dataset.xlsx  SHA-256 {json.loads((OUT/'audit_snapshot.json').read_text())['source_sha256']}",
    "Primary snapshot: 2025-04-11 23:59:59 Asia/Kolkata (pre-festival). Later records are excluded from every sheet here.",
    "Dedupe: exact duplicate rows with the same stable ID removed (SI00001, SI00019, SI00110, BQ0003, OH00001, OH00015). No same-ID conflicts.",
    "Histories: latest full-state version <= cutoff per entity (ties broken by history_id). History rows are never summed.",
    "KPI sheet: column C holds LIVE formulas over the clean sheets; column D is the independent Python value; column E checks they agree.",
    "Validation: this workbook was recalculated by the open-source `formulas` engine; results in KPI!F and outputs/audit/workbook_validation.json.",
    "Labels: [SOURCE] dataset fact · [CALCULATED] transparent derivation · [UNKNOWN] not established by the data.",
    "LIMITATION: no receipts/invoices/payment dates -> historical cash collected is UNKNOWN. No campaign spend -> CAC/ROI not calculable.",
]
for l in lines: readme.append([l])
readme.column_dimensions["A"].width = 140; readme["A1"].font = Font(bold=True, size=13)

_, nI = sheet("Interactions_clean", ix)
_, nQ = sheet("Qualification_latest", ql)
_, nO = sheet("Opportunities_latest", ol)
_, nR = sheet("Stage_reach", reach)
camp = pd.read_csv(OUT / "campaign_reconciliation.csv")
sheet("Campaign_recon", camp)
sheet("Opportunity_recon", pd.read_csv(OUT / "opportunity_reconciliation.csv"))
sheet("Data_quality", pd.read_csv(OUT / "data_quality_report.csv"))

I = lambda col: f"Interactions_clean!${col}$2:${col}${nI}"
Q = lambda col: f"Qualification_latest!${col}$2:${col}${nQ}"
O = lambda col: f"Opportunities_latest!${col}$2:${col}${nO}"
Rr = lambda col: f"Stage_reach!${col}$2:${col}${nR}"
# Interactions_clean columns: A id, B attempt, C is_root, D event_type, E outcome, F brand_id ...
# Opportunities_latest: A id, B name, C brand, D support, E campaign, F created, G stage, H proposed, I confirmed
F = [
    ("unique_attempts", f"=COUNTIFS({I('C')},1)", "Root events (= one per attempt) <= cutoff"),
    ("outbound_attempts", f'=COUNTIFS({I("C")},1,{I("D")},"outreach_sent")', "Root outreach_sent"),
    ("meetings_held", f'=COUNTIFS({I("D")},"meeting_held")', "meeting_held events"),
    ("brands_unique_met", f'=SUMPRODUCT(({I("D")}="meeting_held")/COUNTIFS({I("F")},{I("F")},{I("D")},{I("D")}))', "distinct brands with meeting_held"),
    ("brands_qualified", f'=COUNTIFS({Q("C")},"qualified")', "latest status = qualified"),
    ("brands_dormant", f'=COUNTIFS({Q("C")},"dormant")', "latest status = dormant"),
    ("brands_engaged", f'=COUNTIFS({Q("C")},"engaged")', "latest status = engaged"),
    ("opportunities", f"=COUNTA({O('A')})", "opportunities created <= cutoff"),
    ("confirmed_opportunities", f'=COUNTIFS({O("G")},"partner_confirmed")', "latest stage confirmed"),
    ("confirmed_cash_type_inr", f'=SUMIFS({O("I")},{O("G")},"partner_confirmed",{O("D")},"cash")', "confirmed value, cash-type (NOT cash received)"),
    ("confirmed_in_kind_inr", f'=SUMIFS({O("I")},{O("G")},"partner_confirmed",{O("D")},"in_kind")', "confirmed value, in-kind (never cash)"),
    ("opps_negotiating", f'=COUNTIFS({O("G")},"negotiating")', ""),
    ("opps_lost", f'=COUNTIFS({O("G")},"lost")', ""),
    ("opps_withdrawn", f'=COUNTIFS({O("G")},"withdrawn")', ""),
    ("open_pipeline_proposed_inr", f'=SUMIFS({O("H")},{O("G")},"prospecting")+SUMIFS({O("H")},{O("G")},"contacted")+SUMIFS({O("H")},{O("G")},"proposal_sent")+SUMIFS({O("H")},{O("G")},"negotiating")', "face value of open opps"),
    ("opps_ever_reached_proposal_sent", f"=SUM({Rr('D')})", ""),
    ("opps_ever_reached_negotiating", f"=SUM({Rr('E')})", ""),
    ("opps_ever_reached_partner_confirmed", f"=SUM({Rr('F')})", "includes O006 later withdrawn"),
    ("win_rate_closed", f'=COUNTIFS({O("G")},"partner_confirmed")/(COUNTIFS({O("G")},"partner_confirmed")+COUNTIFS({O("G")},"lost")+COUNTIFS({O("G")},"withdrawn"))', "confirmed / closed"),
]
ws = wb.create_sheet("KPI", 1)
ws.append(["metric", "definition", "excel_formula_value", "python_value", "check", "engine_recalc_value", "engine_check"])
for c in ws[1]: c.font = H; c.fill = HF
for i, (m, f, d) in enumerate(F, start=2):
    pv = py.get(m)
    if m == "brands_unique_met": pv = py.get("brands_met")
    ws.append([m, d, f, None if pd.isna(pv) else float(pv), f"=IF(ABS(C{i}-D{i})<0.0001,\"PASS\",\"FAIL\")"])
ws.append([]); ws.append(["cash_received_inr", "No receipt ledger in source", "UNKNOWN", "UNKNOWN", "LIMITATION"])
for col, w in zip("ABCDEFG", [36, 46, 20, 16, 10, 20, 12]): ws.column_dimensions[col].width = w
path = OUT / "Source_Audit_Workbook.xlsx"
wb.save(path)

# ---- independent recalculation with the `formulas` engine ----
import formulas
xl = formulas.ExcelModel().loads(str(path)).finish()
sol = xl.calculate()
res = []
for i, (m, _, _) in enumerate(F, start=2):
    key = [k for k in sol if k.upper().endswith(f"[{path.name.upper()}]KPI'!C{i}")]
    v = sol[key[0]].value[0, 0] if key else None
    p = ws.cell(i, 4).value
    ok = v is not None and p is not None and abs(float(v) - float(p)) < 1e-4
    res.append({"metric": m, "formula_value": float(v) if v is not None else None, "python_value": p, "pass": ok})
from openpyxl import load_workbook
wb2 = load_workbook(path); k2 = wb2["KPI"]
for i, r in enumerate(res, start=2):
    k2.cell(i, 6).value = r["formula_value"]; k2.cell(i, 7).value = "PASS" if r["pass"] else "FAIL"
wb2.save(path)
summary = {"engine": f"formulas {formulas.__version__}", "checked": len(res), "passed": sum(r["pass"] for r in res), "results": res}
(OUT / "workbook_validation.json").write_text(json.dumps(summary, indent=2))
print(f"{summary['passed']}/{summary['checked']} workbook formulas match the Python audit")
for r in res:
    if not r["pass"]: print("FAIL", r)

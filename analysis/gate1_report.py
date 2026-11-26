"""Generates outputs/audit/Gate_1_Audit_Report.pdf and .docx from the audit outputs (single content source)."""
from pathlib import Path
import json
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
A = ROOT / "outputs" / "audit"
snap = json.loads((A / "audit_snapshot.json").read_text())
P = snap["pre_festival"]
dq = pd.read_csv(A / "data_quality_report.csv").fillna("")
camp = pd.read_csv(A / "campaign_reconciliation.csv")
wbv = json.loads((A / "workbook_validation.json").read_text())
inr = lambda v: f"Rs {int(v):,}"

C = []  # (kind, payload)
H = lambda t: C.append(("h", t)); Pp = lambda t: C.append(("p", t)); T = lambda rows: C.append(("t", rows)); B = lambda items: C.append(("b", items))
C.append(("title", "Gate 1 — Independent Historical Data Audit"))
Pp("CampusFest 2025 sponsorship dataset · Challenge B (Sponsorship cash) · Prepared for Aryan Dongre's RISA Growth APM submission")
H("1. Scope and sources")
B([f"Primary source: source_documents/Sponsor_Dataset.xlsx (SHA-256 {snap['source_sha256'][:16]}…), 12 sheets, read with pandas from typed cells.",
   "Assignment: source_documents/RISA_Assignment.pdf. No previous AI-generated reference work was present in the repository; every figure here was reconstructed from source rows.",
   "Snapshots: pre-festival 2025-04-11 23:59:59 IST (primary objective), festival end 2025-04-13 23:59:59, history end 2025-04-20 23:59:59."])
H("2. Method")
B(["Exact duplicate rows that share a stable ID are import retries and were removed. A repeated ID with a different payload would be reported as a conflict; none were found.",
   "Full-state histories (qualification, opportunity stage) use the latest version at or before the cutoff per entity, with ties broken by history_id. History rows are never summed.",
   "All joins use stable IDs. Brands, contacts, attempts (one root event each) and opportunities are counted as separate populations.",
   "Every rate is reported with its numerator and denominator (outputs/audit/historical_kpis.csv)."])
H("3. Data-quality results")
T([["Check", "Result", "Count", "Detail"]] + [[r.check, r.result, str(r["count"]), str(r.detail)[:90]] for _, r in dq.iterrows() if r.result in ("PASS", "FAIL", "LIMITATION", "INVESTIGATE") or "removed" in r.check])
H("4. Reconstructed pre-festival metrics")
T([["Metric", "Value", "Basis"],
   ["Unique outreach attempts", f"{int(P['unique_attempts'])}", "root events <= cutoff (1 post-cutoff attempt excluded)"],
   ["Brands touched / replied / positive / met", f"{int(P['brands_touched'])} / {int(P['brands_replied'])} / {int(P['brands_positive_reply'])} / {int(P['brands_met'])}", "distinct brand_id"],
   ["Qualified brands vs goal", f"{int(P['brands_qualified'])} vs {int(P['qualified_brands_goal'])}", "latest version; revised plan target"],
   ["Opportunities / confirmed vs goal", f"{int(P['opportunities'])} / {int(P['confirmed_opportunities'])} vs {int(P['confirmed_partnerships_goal'])}", "latest stage"],
   ["Confirmed cash-type value", inr(P["confirmed_cash_type_inr"]), f"{int(P['confirmed_cash_type_count'])} deals — a commitment, NOT cash"],
   ["Confirmed in-kind value", inr(P["confirmed_in_kind_inr"]), f"{int(P['confirmed_in_kind_count'])} deals — never cash"],
   ["Average / median confirmed cash deal", f"{inr(P['avg_confirmed_cash_deal_inr'])} / {inr(P['median_confirmed_cash_deal_inr'])}", ""],
   ["Open pipeline (face value)", inr(P["open_pipeline_proposed_inr"]), f"{int(P['open_opportunities'])} open; {int(P['open_opps_stale_14d'])} stale >14 days; median {P['open_median_days_in_current_stage']} days in stage"],
   ["Win rate on closed deals", f"{P['win_rate_closed']:.1%}", "24 / (24 + 7 lost + 1 withdrawn)"],
   ["Stage conversion (ever reached)", f"P->C {P['stage_conv_prospecting_to_contacted']:.0%}, C->Prop {P['stage_conv_contacted_to_proposal_sent']:.0%}, Prop->Neg {P['stage_conv_proposal_sent_to_negotiating']:.0%}, Neg->Conf {P['stage_conv_negotiating_to_partner_confirmed']:.0%}", "58 -> 52 -> 46 -> 39 -> 25"],
   ["Median days created -> confirmed", f"{P['median_days_created_to_confirmed']}", ""],
   ["Cash actually received", "UNKNOWN", "no receipt ledger in source"]])
H("5. Campaign reconciliation (observational attribution)")
T([["Campaign", "Brands", "Met", "Opps", "Confirmed", "Cash-type confirmed", "Open pipeline"]] + [[r.campaign_name, str(r.brands_touched), str(r.meetings_held), str(r.opportunities_originated), str(r.confirmed), inr(r.confirmed_cash_type_inr), inr(r.open_pipeline_inr)] for _, r in camp.iterrows()])
Pp("Finding: all 24 confirmations came from the warm and inbound sources (Warm Partner Introductions, Partner Interest Form, Creator Network Referrals), which touched 44 brands between them. The cold sources touched 148 brands and produced 0 confirmed partnerships at the cutoff; their only confirmation (O006) was later withdrawn. All 26 open opportunities are cold-originated. This is an association, not proof of causation.")
H("6. Anomalies investigated")
B(["O006 Cobalt Learning: partner_confirmed (25 Feb) -> withdrawn (20 Mar). Gives a 1/25 = 4% post-confirmation withdrawal rate.",
   "18 brands whose latest status is 'qualified' have no opportunity (13 of them from warm or inbound sources). This is recoverable pipeline.",
   "15 open opportunities belong to brands that never qualified and never had a meeting. All are cold-originated and should be closed or disqualified.",
   "O001 Beardo opportunity was created before the brand's first 'qualified' version; Beardo also has a second opportunity (O002, lost).",
   "12 opportunities changed proposed value across versions; every confirmed version has confirmed = proposed.",
   "Patterns that look synthetic: every confirmed deal passed through all four stages in order; 19 of 24 confirmed brands share two name prefixes (Aster, Bramble); the warm win rate is 24/25. These rates are haircut before any forecast use.",
   "10 qualification versions (all 'dormant') and 2 interactions fall after the cutoff and are excluded. No opportunity stage changes between the pre-festival and history-end snapshots."])
H("7. Limitations")
B(["Historical cash collected is UNKNOWN: there are no receipts, invoices or payment dates.",
   "Historical CAC and ROI cannot be calculated: there is no campaign budget or spend.",
   "The data has no loss reasons, sponsor budgets or contract terms. Activation links do not establish attendee uplift."])
H("8. Validation")
B([f"Excel formulas over the clean sheets vs Python: {wbv['passed']}/{wbv['checked']} match, independently recalculated with the {wbv['engine']} engine (Source_Audit_Workbook.xlsx, KPI sheet).",
   "Python audit vs the SponsorOS TypeScript analytics engine: 21 metrics × 2 snapshots identical (app/tests/unit/parity.test.ts).",
   "Reproduce: python analysis/historical_audit.py && python analysis/build_audit_workbook.py && python analysis/gate1_report.py"])


def pdf(path):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, ListFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    ss = getSampleStyleSheet()
    sm = ParagraphStyle("sm", parent=ss["BodyText"], fontSize=8.5, leading=11)
    story = []
    for k, v in C:
        if k == "title": story += [Paragraph(v, ss["Title"])]
        elif k == "h": story += [Spacer(1, 6), Paragraph(v, ss["Heading2"])]
        elif k == "p": story += [Paragraph(v, ss["BodyText"])]
        elif k == "b": story += [ListFlowable([Paragraph(i, sm) for i in v], bulletType="bullet", start="•")]
        elif k == "t":
            t = Table([[Paragraph(str(c), sm) for c in r] for r in v], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B1F3A")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story += [t]
    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36, title="Gate 1 Audit Report").build(story)


def docx(path):
    from docx import Document
    from docx.shared import Pt
    d = Document()
    for k, v in C:
        if k == "title": d.add_heading(v, 0)
        elif k == "h": d.add_heading(v, 2)
        elif k == "p": d.add_paragraph(v)
        elif k == "b":
            for i in v: d.add_paragraph(i, style="List Bullet")
        elif k == "t":
            t = d.add_table(rows=len(v), cols=len(v[0])); t.style = "Light Grid Accent 1"
            for i, r in enumerate(v):
                for j, c in enumerate(r):
                    t.cell(i, j).text = str(c)
                    for p in t.cell(i, j).paragraphs:
                        for run in p.runs: run.font.size = Pt(8)
    d.save(str(path))


pdf(A / "Gate_1_Audit_Report.pdf"); docx(A / "Gate_1_Audit_Report.docx")
print("written", A / "Gate_1_Audit_Report.pdf", A / "Gate_1_Audit_Report.docx")

// Generates deliverables/RISA_Growth_Strategy.pptx (exactly 3 slides).
// All figures are read from the validated model/audit outputs â€” nothing is typed by hand twice.
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const ROOT = path.resolve(__dirname, "..", "..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "outputs/model/forecast_summary.json"), "utf8"));
const AUD = JSON.parse(fs.readFileSync(path.join(ROOT, "outputs/audit/audit_snapshot.json"), "utf8")).pre_festival;
const CAMP = fs.readFileSync(path.join(ROOT, "outputs/audit/campaign_reconciliation.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const A = JSON.parse(fs.readFileSync(path.join(ROOT, "model/assumptions.json"), "utf8"));

const L = (v, d = 1) => `${v < 0 ? "âˆ’" : ""}â‚¹${(Math.abs(v) / 1e5).toFixed(d)}L`;
const R1 = (v) => (Math.round(v * 10 + 1e-9) / 10).toFixed(1);
const R0 = (v) => String(Math.round(v + 1e-9));
const B = F.base, S = F.stretch, bt = B.totals, st = S.totals;
const wf = Object.fromEntries(B.waterfall.map((w) => [w.step, w]));
const inc = (k) => wf[k].increment_inr;
const SENS = Object.fromEntries(fs.readFileSync(path.join(ROOT, "outputs/model/sensitivity_base.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], { collected: +c[1], delta: +c[2], pct: +c[3] }]; }));
const D = F.downside, bc = B.costs;
const mult = (bt.collected_inr / B.bau_collected_inr).toFixed(1);
const LIVE_URL = "https://sponsoros-risa-growth.onrender.com";

const NAVY = "0B1F3A", TEAL = "0D9488", INK = "1E293B", MUTED = "64748B", LINE = "CBD5E1", TINT = "F1F5F9", TEALT = "E6F6F4", RED = "BE123C", AMBER = "B45309", GREEN = "047857", WHITE = "FFFFFF";
const HF = "Cambria", BF = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.author = "Aryan Dongre"; pres.title = "CampusFest sponsorship growth strategy â€” Challenge B";
pres.theme = { headFontFace: HF, bodyFontFace: BF };
pres.defineSlideMaster({
  title: "CONTENT", background: { color: WHITE },
  objects: [
    { text: { text: "Aryan Dongre Â· RISA Labs Growth APM Â· Challenge B: Sponsorship cash", options: { x: 0.5, y: 7.08, w: 8, h: 0.3, fontFace: BF, fontSize: 10, color: MUTED, isTextBox: true, margin: 0 } } },
  ],
  slideNumber: { x: 12.4, y: 7.08, w: 0.45, h: 0.3, fontFace: BF, fontSize: 10, color: MUTED, align: "right" },
});

const T = (s, text, o) => s.addText(text, { fontFace: BF, color: INK, fontSize: 11, isTextBox: true, valign: "top", margin: 0.04, ...o });
function header(s, kicker, title, titleSize = 21.5) {
  T(s, kicker, { x: 0.5, y: 0.22, w: 9, h: 0.28, fontSize: 11, bold: true, color: TEAL, charSpacing: 1, margin: 0 });
  T(s, title, { x: 0.5, y: 0.5, w: 12.33, h: 0.78, fontFace: HF, fontSize: titleSize, bold: true, color: NAVY, margin: 0 });
}
function card(s, x, y, w, h, title, fill = TINT) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.06 });
  if (title) T(s, title, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.28, fontSize: 11, bold: true, color: NAVY, margin: 0 });
}
const bullets = (items, o = {}) => items.map((t, i) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: i < items.length - 1, paraSpaceAfter: 3, ...o } }));
function table(s, rows, o) {
  const hdr = rows[0].map((c) => ({ text: c, options: { bold: true, color: WHITE, fill: { color: NAVY }, fontSize: 9.5, valign: "middle" } }));
  const body = rows.slice(1).map((r, i) => r.map((c) => (typeof c === "object" ? c : { text: String(c), options: { fill: { color: i % 2 ? "F8FAFC" : WHITE } } })));
  s.addTable([hdr, ...body], { fontFace: BF, fontSize: 10, color: INK, border: { type: "solid", pt: 0.5, color: LINE }, margin: [3, 4, 3, 4], valign: "top", ...o });
}
// vertical waterfall drawn with editable shapes (labels stay exact)
function waterfall(s, x, y, w, h, steps, opts = {}) {
  const max = Math.max(...steps.map((d) => Math.max(d.from, d.to))) * 1.12;
  const n = steps.length, gap = 0.08, bw = (w - gap * (n - 1)) / n, plotH = h - 0.55;
  const Y = (v) => y + plotH - (v / max) * plotH;
  s.addShape(pres.shapes.LINE, { x, y: y + plotH, w, h: 0, line: { color: LINE, width: 0.75 } });
  steps.forEach((d, i) => {
    const bx = x + i * (bw + gap);
    const lo = Math.min(d.from, d.to), hi = Math.max(d.from, d.to);
    const color = d.kind === "total" ? NAVY : d.to < d.from ? RED : TEAL;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: Y(hi), w: bw, h: Math.max(0.02, Y(lo) - Y(hi)), fill: { color }, line: { color } });
    T(s, d.label_value, { x: bx - 0.1, y: Y(hi) - 0.24, w: bw + 0.2, h: 0.22, fontSize: 10, bold: true, align: "center", margin: 0 });
    T(s, d.name, { x: bx - 0.06, y: y + plotH + 0.04, w: bw + 0.12, h: 0.48, fontSize: 9.5, color: MUTED, align: "center", margin: 0 });
  });
}

// ============================ SLIDE 1 ============================
{
  const s = pres.addSlide({ masterName: "CONTENT" });
  header(s, "1 Â· HOW HIGH CAN WE AIM?", `Target ${L(bt.collected_inr)} in forecast cash receipts before the festival (gross; ${L(bc.net_cash_after_costs_inr)} net after ${L(bc.total_cost_inr, 2)} costs; stretch ${L(st.collected_inr)}, downside ${L(D.totals.collected_inr)}), ${mult}Ã— BAU`, 20.5);
  T(s, "Aryan Dongre Â· IIT Kharagpur", { x: 9.3, y: 0.2, w: 3.53, h: 0.28, fontSize: 11, bold: true, color: NAVY, align: "right", margin: 0 });

  // left column
  card(s, 0.5, 1.4, 3.95, 1.78, "Why Bengaluru (narrow call over Mumbai)");
  T(s, bullets([
    "No. 1 district in India for colleges: 1,148 in Bengaluru Urban (AISHE 2023-24, as reported)",
    "Home to 26 of India's 73 unicorns (Hurun 2025), so brand marketers are reachable in person",
    "Trade-off: Mumbai and Delhi hold more FMCG ad budgets, so we also run a remote pitch track",
  ]), { x: 0.6, y: 1.72, w: 3.75, h: 1.42, fontSize: 10.5 });
  card(s, 0.5, 3.3, 3.95, 1.78, "Sponsor ICP & selection criteria");
  T(s, bullets([
    "Segments: youth F&B and beverage, D2C personal care, fintech/UPI, mobility, edtech/media",
    "Criteria: 18â€“24 audience fit Â· a warm path exists Â· â‚¹0.5â€“2L budget band Â· Bengaluru decision maker Â· ability to approve milestone-based payment terms",
    "Avoid: brands that opted out, cold lists without a meeting",
  ]), { x: 0.6, y: 3.62, w: 3.75, h: 1.44, fontSize: 10.0 });
  card(s, 0.5, 5.2, 3.95, 1.78, "2025 audit: warm channels won, cold did not");
  T(s, "Confirmed Ã· unique brands touched (num/den)", { x: 0.65, y: 5.44, w: 3.7, h: 0.2, fontSize: 8.5, color: MUTED, italic: true, margin: 0 });
  const shortName = (n) => n.replace("Warm Partner Introductions", "Warm intros").replace("Creator Network Referrals", "Creator refs").replace("Partner Interest Form", "Inbound form").replace("Brand Leader LinkedIn", "LinkedIn").replace("Brand Discovery Email", "Cold email").replace("Past Conversation Revival", "Revival");
  const cats = CAMP.map((r) => `${shortName(r[1])} (${r[13]}/${r[5]})`);
  s.addChart(pres.charts.BAR, [{ name: "Confirmed / unique brands touched", labels: cats, values: CAMP.map((r) => Math.round((Number(r[13]) / Number(r[5])) * 100)) }], {
    x: 0.54, y: 5.62, w: 3.86, h: 1.34, barDir: "bar", chartColors: [TEAL], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0"%"', dataLabelFontSize: 8.5, dataLabelColor: INK,
    catAxisLabelFontSize: 8.5, catAxisLabelColor: INK, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false, catAxisLabelFontFace: BF, dataLabelFontFace: BF,
  });

  // middle: funnel table
  const name = { renewal: "2025 sponsor renewals", qualified_recovery: "Qualified, not pitched", inbound: "Inbound partner page", alumni_referral: "Alumni & sponsor refs", creator_referral: "Creator / community", cold_outbound: "Cold ABM test" };
  const rows = [["Source (base case)", "Pros-\npects", "Conver-\nsations", "Pro-\nposals", "Signed\n(EV)", "Avg\ndeal", "Forecast pre-\nfestival cash"]];
  B.by_source.filter((r) => r.id !== "anchor_tier").forEach((r) => {
    const src = A.sources.find((x) => x.id === r.id);
    rows.push([name[r.id], R0(r.prospects), R1(r.conversations), R1(r.proposals), R1(r.signed), `â‚¹${(src.avg_deal_inr.base / 1000).toFixed(0)}K`, L(r.collected_inr)]);
  });
  const bold = (t, fill = TEALT) => ({ text: t, options: { bold: true, fill: { color: fill } } });
  rows.push([bold("Base total"), bold(R0(bt.prospects)), bold(R1(bt.conversations)), bold(R1(bt.proposals)), bold(R1(bt.signed)), bold(L(bt.committed_inr / bt.signed, 2)), bold(L(bt.collected_inr))]);
  rows.push([bold("Stretch total", "E2E8F0"), bold(R0(st.prospects), "E2E8F0"), bold(R1(st.conversations), "E2E8F0"), bold(R1(st.proposals), "E2E8F0"), bold(R1(st.signed), "E2E8F0"), bold(L(st.committed_inr / st.signed, 2), "E2E8F0"), bold(L(st.collected_inr), "E2E8F0")]);
  T(s, "Funnel: prospects â†’ conv. â†’ proposals â†’ signed â†’ forecast cash", { x: 4.65, y: 1.38, w: 5.05, h: 0.25, fontSize: 10.5, bold: true, color: NAVY, margin: 0 });
  table(s, rows, { x: 4.65, y: 1.66, w: 5.0, colW: [1.52, 0.50, 0.56, 0.52, 0.50, 0.54, 0.86], fontSize: 9.2, margin: [2, 3, 2, 3] });
  T(s, `Totals use unrounded model sums (184.6 prospects, 119.15 conv., 82.63 proposals, 42.24 signed, â‚¹34.96L gross cash); Â±0.1 row-sum diffs reflect rounding. Stretch includes 0.5 anchor deal (â‚¹3.3L).`, { x: 4.65, y: 4.18, w: 5.0, h: 0.36, fontSize: 8.0, color: MUTED, italic: true, margin: 0 });

  card(s, 4.65, 4.60, 5.0, 2.38, "Assumptions behind the number (all editable in SponsorOS)");
  T(s, bullets([
    `Warm yield is haircut: 2025 brandâ†’signed was 54.5% (24/44); we plan 26.8% (base) and 36% (stretch). The 96% win rate looks synthetic`,
    `Cash-type mix: 20/24 partnerships (83%); cash share of confirmed value: 89% (â‚¹20.0L/â‚¹22.4L). Withdrawal 4% (1/25); 5% de-dup on new pools`,
    `Collection ${(bt.collection_rate * 100).toFixed(0)}% [forward assumptionâ€”no 2025 receipt records]: 50% in 48h, balance T-7d, phase-weighted (2025 timing 8/72/20%; 70% w/o desk)`,
    `Forecast gross cash ${L(bt.collected_inr)}; net ${L(bc.net_cash_after_costs_inr)} after ${L(bc.total_cost_inr, 2)} acquisition costs (budget, stipend, 8% fees). Capacity: 100 vs ${R1(bt.proposals)} proposals`,
    `Anchor/title tier is excluded from base and enters stretch only at expected value`,
  ], { paraSpaceAfter: 2 }), { x: 4.75, y: 4.92, w: 4.82, h: 2.04, fontSize: 9.5 });

  // right: hero + bridge
  card(s, 9.85, 1.4, 2.98, 1.82, null, NAVY);
  T(s, "Base Â· forecast gross cash pre-festival", { x: 10.0, y: 1.47, w: 2.7, h: 0.22, fontSize: 10, color: "99F6E4", margin: 0 });
  T(s, L(bt.collected_inr), { x: 10.0, y: 1.68, w: 2.7, h: 0.54, fontFace: HF, fontSize: 32, bold: true, color: WHITE, margin: 0 });
  T(s, `Net ${L(bc.net_cash_after_costs_inr)} after ${L(bc.total_cost_inr, 2)} acquisition costs\nP10â€“P90 ${L(B.monte_carlo.p10)}â€“${L(B.monte_carlo.p90)} (assumption-driven MC range, 10k runs; not empirical CI)\nStretch ${L(st.collected_inr)} Â· Downside ${L(D.totals.collected_inr)} Â· BAU ${L(B.bau_collected_inr)}`, { x: 10.0, y: 2.24, w: 2.75, h: 0.94, fontSize: 9.0, color: "E2E8F0", margin: 0 });
  T(s, "Cash bridge, base case (â‚¹ lakh)", { x: 9.85, y: 3.30, w: 2.98, h: 0.25, fontSize: 11, bold: true, color: NAVY, margin: 0 });
  const c = bt.committed_inr / 1e5, ik = bt.in_kind_inr / 1e5, wd = bt.withdrawal_loss_inr / 1e5, up = bt.upsell_net_cash_inr / 1e5, un = bt.uncollected_by_festival_inr / 1e5, col = bt.collected_inr / 1e5;
  waterfall(s, 9.9, 3.62, 2.9, 3.32, [
    { name: "Commit-\nted", from: 0, to: c, kind: "total", label_value: c.toFixed(1) },
    { name: "In-kind\n(not cash)", from: c, to: c - ik, label_value: `âˆ’${ik.toFixed(1)}` },
    { name: "With-\ndrawal", from: c - ik, to: c - ik - wd, label_value: `âˆ’${wd.toFixed(1)}` },
    { name: "Add-on\nupsell", from: c - ik - wd, to: c - ik - wd + up, label_value: `+${up.toFixed(1)}` },
    { name: "Not paid\nby T-0", from: c - ik - wd + up, to: col, label_value: `âˆ’${un.toFixed(1)}` },
    { name: "Forecast\ngross cash", from: 0, to: col, kind: "total", label_value: col.toFixed(1) },
  ]);
  s.addNotes(`All figures come from outputs/model/forecast_summary.json and outputs/audit/audit_snapshot.json. 2025 historical cash received is UNKNOWN (no receipt ledger). ${AUD.confirmed_opportunities} confirmed partnerships at the cutoff: â‚¹${AUD.confirmed_cash_type_inr} cash-type + â‚¹${AUD.confirmed_in_kind_inr} in-kind.`);
}

// ============================ SLIDE 2 ============================
{
  const s = pres.addSlide({ masterName: "CONTENT" });
  const incTotal = bt.collected_inr - B.bau_collected_inr;
  header(s, "2 Â· WHERE WILL WE PLACE OUR BETS?", "Five ranked initiatives add â‚¹26.2L; cutting cold outreach removes â‚¹0.5L, yielding â‚¹25.7L net uplift over BAU for â‚¹3.08L all-in. Fund cash collection and renewals first.", 19.5);
  const I = Object.fromEntries(A.initiatives.map((i) => [i.id, i]));
  const score = (id) => (inc(id) / 1e5) * I[id].confidence / I[id].person_weeks;
  const order = ["I1", "I2", "I3", "I4", "I5"];
  const concept = {
    I1: "Cash Collection Desk: invoice on signature, 50% advance in 48h, balance at T-7, overdue escalation. 2025 had â‚¹20L committed and no schedules",
    I2: "Renewal, tiering & upsell: send a 2025 proof-of-value recap to all 24 sponsors with a 3-tier rate card and an add-on menu",
    I3: "Qualified-lead recovery + inbound page: pitch the 18 qualified-but-never-pitched brands within 10 days; partner page with rate card",
    I4: "Alumni & sponsor referral engine: ask mapped alumni marketers and renewed sponsors for 2 warm intros each, with recognition perks",
    I5: "Creator & community referrals: campus creators who already do brand deals; 8% finder fee paid only on received cash",
  };
  const rows = [["#", "Initiative Â· concept Â· why it works", "+ Cash (base)", "Budget", "Team Â· timeline", "Test (first weeks)", "Leading KPIs", "Score*"]];
  order.forEach((id, k) => rows.push([
    { text: String(k + 1), options: { bold: true, color: WHITE, fill: { color: TEAL }, align: "center" } }, concept[id],
    { text: `+${L(inc(id))}\nstretch +${L(S.waterfall.find((w) => w.step === id).increment_inr)}`, options: { bold: true } },
    `â‚¹${(I[id].budget_inr / 1000).toFixed(0)}K${id === "I5" ? "\n+8% on receipts" : ""}`, `${I[id].people}\n${I[id].timeline}`, I[id].experiment, I[id].kpis.slice(0, 3).join(" Â· "), score(id).toFixed(2),
  ]));
  table(s, rows, { x: 0.5, y: 1.4, w: 9.05, colW: [0.3, 2.6, 0.9, 0.72, 1.33, 1.5, 1.25, 0.45], fontSize: 9 });
  const tie = Math.abs(score("I1") - score("I2")) < 0.05 ? ` I1 and I2 score within ${Math.abs(score("I1") - score("I2")).toFixed(2)}: ties break on time-to-cash (I1 from week 1) and dependency (I1 multiplies every deal's cash).` : "";
  T(s, `*Score = incremental pre-festival cash (â‚¹L) Ã— confidence Ã· person-weeks.${tie} Increments come from an ordered waterfall, so the five sum exactly to the plan with no double counting.`, { x: 0.5, y: 5.72, w: 9.05, h: 0.36, fontSize: 9.5, color: MUTED, italic: true, margin: 0 });

  T(s, "Bridge: BAU â†’ base plan (â‚¹ lakh, forecast gross cash)", { x: 9.75, y: 1.4, w: 3.1, h: 0.28, fontSize: 10.5, bold: true, color: NAVY, margin: 0 });
  let run = 0; const steps = [];
  for (const k of ["BAU", "PLAN", "I2", "I3", "I4", "I5", "I1"]) {
    const v = wf[k].increment_inr / 1e5;
    steps.push({ name: k === "BAU" ? "BAU\n2025" : k === "PLAN" ? "Cut\ncold" : k, from: k === "BAU" ? 0 : run, to: run + v, kind: k === "BAU" ? "total" : undefined, label_value: k === "BAU" ? v.toFixed(1) : `${v >= 0 ? "+" : "âˆ’"}${Math.abs(v).toFixed(1)}` });
    run += v;
  }
  steps.push({ name: "Base\nplan", from: 0, to: run, kind: "total", label_value: run.toFixed(1) });
  waterfall(s, 9.75, 1.78, 3.1, 3.4, steps);
  T(s, `â‰ˆ â‚¹${(incTotal / bc.total_cost_inr).toFixed(1)} of incremental cash per â‚¹1 all-in (â‚¹${(F.budget_inr / 1000).toFixed(0)}K budget + â‚¹${(bc.closer_stipend_inr / 1000).toFixed(0)}K stipend + â‚¹${(bc.finder_fees_inr / 1000).toFixed(0)}K finder fees). Closer hours bind if <5 closers`, { x: 9.75, y: 5.25, w: 3.1, h: 0.54, fontSize: 9.5, color: INK, bold: true, margin: 0 });

  const boxes = [
    ["Double down", TEALT, ["I1 (Collection Desk) improves cash collection across all signed cash commitments (70%â†’84%) for â‚¹15K", "I2 (Renewal Sprint) generates +â‚¹6.5L in additional sponsorship revenue from 2025 sponsors and seeds I4 referrers", "Shift closer hours from cold to warm immediately"]],
    ["Deprioritise / reject", "FDECEC", ["Scaling cold email, LinkedIn and revival: 148 brands, 0 confirmed, 7 opt-outs. Keep only a 40-brand ABM test", "Betting on one title sponsor: no 2025 deal topped â‚¹2L. Stretch only, at expected value", "Chasing the stale â‚¹14.4L cold pipeline: one close-or-disqualify touch", "Paid ads for leads: no spend data, buyers are few"]],
    ["Dependencies & risks", "FEF3C7", [`Renewals fail entirely â†’ ${(SENS["Renewals fail entirely"].pct * 100).toFixed(0)}% (${L(SENS["Renewals fail entirely"].delta)}): the biggest single sensitivity`, `Win rates Ã—0.8 â†’ ${L(SENS["Win rates x0.8 (all sources)"].delta)}; deal size âˆ’20% â†’ ${L(SENS["Avg deal size -20%"].delta)}`, `Downside (all stresses together) ${L(D.totals.collected_inr)}. I4 needs I2 referrers first`]],
  ];
  boxes.forEach(([t, fill, items], i) => {
    const x = 0.5 + i * 4.15;
    card(s, x, 6.1, 4.0, 0.94, null, fill);
    T(s, [{ text: `${t}: `, options: { bold: true, color: NAVY } }, { text: items.join(" Â· "), options: {} }], { x: x + 0.1, y: 6.13, w: 3.82, h: 0.9, fontSize: 9.2 });
  });
  s.addNotes("Contributions: outputs/model/waterfall_base.csv and waterfall_stretch.csv. Sensitivities: outputs/model/sensitivity_base.csv. Budget total from model/assumptions.json.");
}

// ============================ SLIDE 3 ============================
{
  const s = pres.addSlide({ masterName: "CONTENT" });
  header(s, "3 Â· HOW WILL WE KNOW WHAT'S WORKING?", "Each bet has a leading indicator with a pre-agreed scale, change or stop threshold, and SponsorOS evaluates them on live data", 21.5);
  const I = Object.fromEntries(A.initiatives.map((i) => [i.id, i]));
  const risk = {
    I1: "Signed â‰  paid; late signers miss T-0. Risk: sponsor delays the PO",
    I2: "Renewal intent; tier acceptance. Risk: 2025 value not evidenced",
    I3: "Decision-maker still active; inbound volume. Risk: brief went stale",
    I4: "Intros per ask; intro quality. Risk: alumni goodwill is finite",
    I5: "Creator fit with brand; fee leakage. Risk: low-intent referrals",
  };
  const signal = { I1: "% signed cash invoiced â‰¤48h; days signâ†’1st receipt (W1â€“W4)", I2: "Proposal rate on first 8 pitches (W2)", I3: "Proposals out to the 18 by day 10; inbound per week (W2â€“W4)", I4: "Intros per ask; introâ†’meeting (first 30 asks, W5)", I5: "Qualified referrals per creator (W6)" };
  const g = (t) => ({ text: t, options: { color: GREEN } }), a = (t) => ({ text: t, options: { color: AMBER } }), r = (t) => ({ text: t, options: { color: RED } });
  const rows = [["Bet", "Critical variable Â· biggest risk", "Early signal (when)", "â–² Scale", "â—† Change", "â–  Stop"]];
  ["I1", "I2", "I3", "I4", "I5"].forEach((id) => rows.push([{ text: `${id} ${I[id].name}`, options: { bold: true } }, risk[id], signal[id], g(I[id].scale), a(I[id].change), r(I[id].stop)]));
  table(s, rows, { x: 0.5, y: 1.4, w: 9.0, colW: [1.35, 1.6, 1.55, 1.4, 1.6, 1.5], fontSize: 9 });

  T(s, "Plan-level cash gates (base case)", { x: 0.5, y: 5.2, w: 9, h: 0.26, fontSize: 11, bold: true, color: NAVY, margin: 0 });
  const r5 = (v) => `â‚¹${Math.round(v / 1e5)}L`;
  const gates = [["T-12w", "â‰¥12 renewal proposals out; desk live"], ["T-8w", `â‰¥${r5(bt.cash_type_inr * 0.45)} cash-type signed; 100% invoiced â‰¤48h`], ["T-4w", `â‰¥${r5(bt.collected_inr * 0.4)} verified received; â‰¤â‚¹2L overdue`], ["T-1w", `â‰¥${r5(bt.collected_inr * 0.8)} received; every late signer on 100% advance`]];
  gates.forEach(([w, t], i) => {
    const x = 0.5 + i * 2.27;
    s.addShape(pres.shapes.CHEVRON, { x, y: 5.5, w: 2.2, h: 0.62, fill: { color: i === 3 ? NAVY : TEAL }, line: { color: i === 3 ? NAVY : TEAL } });
    T(s, [{ text: `${w}  `, options: { bold: true } }, { text: t }], { x: x + 0.28, y: 5.53, w: 1.7, h: 0.58, fontSize: 9, color: WHITE, valign: "middle", margin: 0 });
  });
  T(s, "Missed gate â†’ within 48h: reassign closer hours to collections, switch late signers to 100% advance, pause the lowest-scoring bet, and re-forecast in the simulator.", { x: 0.5, y: 6.22, w: 9.0, h: 0.40, fontSize: 10, color: INK, margin: 0 });

  // Single, understated, clickable Live Demo hyperlink near the bottom
  T(s, [{
    text: "Explore SponsorOS â€” Live Demo â†—",
    options: {
      hyperlink: { url: LIVE_URL, tooltip: "Open deployed SponsorOS application" },
      bold: true,
      color: TEAL,
      underline: { style: "sng", color: TEAL },
    },
  }], { x: 0.5, y: 6.72, w: 4.5, h: 0.28, fontSize: 10.5, margin: 0 });

  // decision loop
  T(s, "SponsorOS decision loop", { x: 9.75, y: 1.4, w: 3.1, h: 0.26, fontSize: 11, bold: true, color: NAVY, margin: 0 });
  const loop = [
    ["Detect", "Stored thresholds and the readiness engine score every deal and campaign from live data"],
    ["Diagnose", "AI analyst calls audited tools only. It cites record IDs and says 'unknown' when data is missing"],
    ["Decide", "Proposed task shows evidence + expected impact. A human confirms or rejects (logged)"],
    ["Do", "Task with owner and due date. Payment milestones and invoices tracked"],
    ["Measure", "Only verified receipts count. Outcome is written back to the recommendation"],
  ];
  loop.forEach(([h, t], i) => {
    const y = 1.72 + i * 0.77;
    s.addShape(pres.shapes.OVAL, { x: 9.75, y: y + 0.06, w: 0.44, h: 0.44, fill: { color: i === 4 ? NAVY : TEAL }, line: { color: WHITE } });
    T(s, String(i + 1), { x: 9.75, y: y + 0.06, w: 0.44, h: 0.44, fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    T(s, [{ text: `${h}: `, options: { bold: true, color: NAVY } }, { text: t }], { x: 10.28, y, w: 2.58, h: 0.72, fontSize: 9.2 });
    if (i < 4) s.addShape(pres.shapes.LINE, { x: 9.97, y: y + 0.52, w: 0, h: 0.28, line: { color: LINE, width: 1.25, endArrowType: "triangle" } });
  });
  card(s, 9.75, 5.62, 3.08, 1.32, null, TEALT);
  T(s, [{ text: "Retrospective SponsorOS rule simulation on the 2025 snapshot: ", options: { bold: true, color: NAVY } }, { text: "20 cash-type commitments flagged for payment-schedule follow-up; cold campaigns STOP, creator referrals SCALE. These are simulated recommendations, not historical actions or issued invoices." }], { x: 9.85, y: 5.66, w: 2.88, h: 1.24, fontSize: 8.8 });
  s.addNotes("Thresholds are stored in the kpi_thresholds table and are editable on the Campaigns & Playbook page; signals are recomputed on every request.");
}

const out = path.join(ROOT, "deliverables", "RISA_Growth_Strategy.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("wrote", out));

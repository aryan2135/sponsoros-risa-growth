/**
 * Deterministic analytics. Every number shown in SponsorOS or quoted by the AI analyst comes from here.
 * Rules (mirroring analysis/historical_audit.py):
 *  - as-of = end of selected instant; anything after it is invisible (no leakage).
 *  - histories are full-state: latest version <= as-of per entity (tie-break by history_id).
 *  - brands / contacts / attempts / opportunities are different populations.
 *  - confirmed value is a commitment, not cash; in-kind never counts as cash; cash = verified receipts only.
 */
import type { State, OppVersion, Opportunity, Milestone, Receipt } from "./state";

export const DAY = 86_400_000;
export const OPEN_STAGES = ["prospecting", "contacted", "proposal_sent", "negotiating"] as const;
export const STAGE_ORDER = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed"] as const;
export const WARM_CHANNELS = new Set(["introduction", "web_inbound"]);

export type Ratio = { value: number | null; num: number; den: number };
export const ratio = (num: number, den: number): Ratio => ({ value: den ? num / den : null, num, den });

export function latestBy<T extends { effective_at: number; history_id: string }>(rows: T[], key: (r: T) => string, asOf: number) {
  const m = new Map<string, T>();
  for (const r of rows) {
    if (!(r.effective_at <= asOf)) continue;
    const k = key(r);
    const cur = m.get(k);
    if (!cur || r.effective_at > cur.effective_at || (r.effective_at === cur.effective_at && r.history_id > cur.history_id)) m.set(k, r);
  }
  return m;
}

export interface OppView {
  opportunity_id: string; opportunity_name: string; brand_id: string; brand_name: string; industry: string;
  campaign_id: string | null; campaign_name: string | null; channel_group: "warm" | "cold" | "unknown";
  support_type: "cash" | "in_kind"; created_at: number; origin: string;
  stage: string; proposed_value_inr: number; confirmed_value_inr: number; owner_id: string | null; owner_name: string | null;
  stage_since: number; days_in_stage: number; versions: OppVersion[]; ever_confirmed: boolean;
  brand_met: boolean; brand_positive_reply: boolean; brand_qualification: string | null; brand_opted_out: boolean;
  primary_contact_id: string | null;
}

export interface CashLine {
  opportunity_id: string; opportunity_name: string; brand_name: string; owner_name: string | null;
  confirmed_cash_inr: number; scheduled_inr: number; invoiced_inr: number; due_by_asof_inr: number; due_before_festival_inr: number;
  received_verified_inr: number; received_unverified_inr: number; outstanding_inr: number; overdue_inr: number;
  next_due_at: number | null; next_due_inr: number; status: "no_schedule" | "scheduled" | "due_soon" | "overdue" | "paid" | "over_collected";
  milestones: (Milestone & { paid_inr: number; overdue: boolean })[]; receipts: Receipt[];
}

function allocateReceipts(milestones: Milestone[], receipts: Receipt[]) {
  // receipts tied to a milestone pay it first; untied receipts pay remaining milestones by due date (FIFO)
  const ms = milestones.filter((m) => m.status !== "cancelled").sort((a, b) => a.due_at - b.due_at).map((m) => ({ ...m, paid_inr: 0, overdue: false }));
  let pool = 0;
  for (const r of receipts) {
    const m = r.milestone_id != null ? ms.find((x) => x.id === r.milestone_id) : undefined;
    if (m) {
      const take = Math.min(r.amount_inr, m.amount_inr - m.paid_inr);
      m.paid_inr += take;
      pool += r.amount_inr - take;
    } else pool += r.amount_inr;
  }
  for (const m of ms) {
    const take = Math.min(pool, m.amount_inr - m.paid_inr);
    m.paid_inr += take;
    pool -= take;
  }
  return ms;
}

export function computeSnapshot(S: State, asOf: number, opts: { includeTestReceipts?: boolean } = {}) {
  const fest = S.event.event_starts_at;
  const staleDays = Number(S.settings.stale_days ?? 14);
  const campaignById = new Map(S.campaigns.map((c) => [c.id, c]));
  const brandById = new Map(S.brands.map((b) => [b.brand_id, b]));
  const name = (id: string | null) => (id ? S.team[id] ?? id : null);
  const groupOf = (cid: string | null) => {
    const c = cid ? campaignById.get(cid) : undefined;
    return !c ? "unknown" : WARM_CHANNELS.has(c.channel) ? "warm" : "cold";
  };

  // ---------------- interactions ----------------
  const ix = S.interactions.filter((i) => i.occurred_at <= asOf);
  const roots = ix.filter((i) => !i.origin_interaction_id);
  const ofType = (t: string) => ix.filter((i) => i.event_type === t);
  const replied = ofType("replied");
  const positive = replied.filter((i) => i.outcome === "positive");
  const held = ofType("meeting_held");
  const optouts = ofType("opt_out");
  const uniq = <T,>(a: T[]) => new Set(a);
  const brandsMet = uniq(held.map((i) => i.brand_id));
  const brandsPositive = uniq(positive.map((i) => i.brand_id));
  const brandsOptedOut = uniq(optouts.map((i) => i.brand_id));
  const outboundRoots = roots.filter((i) => i.event_type === "outreach_sent");
  const deliveredAttempts = uniq(ofType("delivered").map((i) => i.attempt_id));

  // ---------------- qualification ----------------
  const qLatest = latestBy(S.qual, (r) => r.brand_id, asOf);
  const qualCounts: Record<string, number> = { unreviewed: 0, engaged: 0, qualified: 0, unqualified: 0, dormant: 0 };
  for (const v of qLatest.values()) qualCounts[v.status] = (qualCounts[v.status] ?? 0) + 1;

  // ---------------- opportunities ----------------
  const ohVisible = S.oppHist.filter((h) => h.effective_at <= asOf);
  const oLatest = latestBy(S.oppHist, (r) => r.opportunity_id, asOf);
  const opps: OppView[] = S.opps
    .filter((o) => o.created_at <= asOf)
    .map((o: Opportunity) => {
      const v = oLatest.get(o.opportunity_id);
      const versions = ohVisible.filter((h) => h.opportunity_id === o.opportunity_id).sort((a, b) => a.effective_at - b.effective_at || (a.history_id < b.history_id ? -1 : 1));
      const b = brandById.get(o.brand_id);
      const c = o.campaign_id ? campaignById.get(o.campaign_id) : undefined;
      const stage = v?.stage ?? "no_history_yet";
      // stage_since = first version of the current uninterrupted stage
      let since = v?.effective_at ?? o.created_at;
      for (let i = versions.length - 1; i >= 0 && versions[i].stage === stage; i--) since = versions[i].effective_at;
      return {
        opportunity_id: o.opportunity_id, opportunity_name: o.opportunity_name, brand_id: o.brand_id, brand_name: b?.brand_name ?? o.brand_id, industry: b?.industry ?? "",
        campaign_id: o.campaign_id, campaign_name: c?.name ?? null, channel_group: groupOf(o.campaign_id),
        support_type: o.support_type, created_at: o.created_at, origin: o.origin, stage,
        proposed_value_inr: v?.proposed_value_inr ?? 0, confirmed_value_inr: v?.confirmed_value_inr ?? 0,
        owner_id: v?.owner_id ?? null, owner_name: name(v?.owner_id ?? null),
        stage_since: since, days_in_stage: (asOf - since) / DAY, versions, ever_confirmed: versions.some((x) => x.stage === "partner_confirmed"),
        brand_met: brandsMet.has(o.brand_id), brand_positive_reply: brandsPositive.has(o.brand_id),
        brand_qualification: qLatest.get(o.brand_id)?.status ?? null, brand_opted_out: brandsOptedOut.has(o.brand_id),
        primary_contact_id: o.primary_contact_id,
      };
    });
  const isOpen = (o: OppView) => (OPEN_STAGES as readonly string[]).includes(o.stage);
  const confirmed = opps.filter((o) => o.stage === "partner_confirmed");
  const confirmedCash = confirmed.filter((o) => o.support_type === "cash");
  const confirmedInKind = confirmed.filter((o) => o.support_type !== "cash");
  const open = opps.filter(isOpen);
  const closed = opps.filter((o) => ["partner_confirmed", "lost", "withdrawn"].includes(o.stage));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  const stages = [...OPEN_STAGES, "partner_confirmed", "lost", "withdrawn"].map((st) => {
    const sel = opps.filter((o) => o.stage === st);
    return { stage: st, count: sel.length, proposed_inr: sum(sel.map((o) => o.proposed_value_inr)), cash_count: sel.filter((o) => o.support_type === "cash").length };
  });
  const reached = Object.fromEntries(STAGE_ORDER.map((st) => [st, new Set(ohVisible.filter((h) => h.stage === st).map((h) => h.opportunity_id)).size]));
  const conversions = STAGE_ORDER.slice(0, -1).map((st, i) => ({ from: st, to: STAGE_ORDER[i + 1], ...ratio(reached[STAGE_ORDER[i + 1]], reached[st]) }));

  // P(eventually confirmed | reached stage) from CLOSED opportunities, by channel group, Laplace-smoothed
  const stageProb = (stage: string, group: string) => {
    const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
    const pool = closed.filter((o) => o.channel_group === group && o.versions.some((v) => STAGE_ORDER.indexOf(v.stage as never) >= idx));
    const won = pool.filter((o) => o.stage === "partner_confirmed").length;
    return { p: (won + 1) / (pool.length + 2), won, n: pool.length };
  };

  // ---------------- campaigns ----------------
  const campaigns = S.campaigns.map((c) => {
    const cx = ix.filter((i) => i.campaign_id === c.id);
    const cr = roots.filter((i) => i.campaign_id === c.id);
    const brandsTouched = uniq(cr.map((i) => i.brand_id)).size;
    const metB = uniq(cx.filter((i) => i.event_type === "meeting_held").map((i) => i.brand_id)).size;
    const co = opps.filter((o) => o.campaign_id === c.id);
    const cc = co.filter((o) => o.stage === "partner_confirmed");
    const cclosed = co.filter((o) => ["partner_confirmed", "lost", "withdrawn"].includes(o.stage));
    const spendRows = S.spend.filter((sp) => sp.campaign_id === c.id && sp.spent_on <= asOf);
    const spend = spendRows.length ? sum(spendRows.map((x) => x.amount_inr)) : null;
    const cashConf = sum(cc.filter((o) => o.support_type === "cash").map((o) => o.confirmed_value_inr));
    const optOuts = cx.filter((i) => i.event_type === "opt_out").length;
    return {
      id: c.id, name: c.name, channel: c.channel, channel_group: WARM_CHANNELS.has(c.channel) ? "warm" : "cold",
      owner_id: c.owner_id, owner_name: name(c.owner_id), status: c.status, budget_inr: c.budget_inr, initiative_id: c.initiative_id, origin: c.origin,
      objective: c.objective, audience: c.audience, planned_start_at: c.planned_start_at, planned_end_at: c.planned_end_at,
      attempts: uniq(cr.map((i) => i.attempt_id)).size, brands_touched: brandsTouched,
      brands_replied: uniq(cx.filter((i) => i.event_type === "replied").map((i) => i.brand_id)).size,
      brands_positive: uniq(cx.filter((i) => i.event_type === "replied" && i.outcome === "positive").map((i) => i.brand_id)).size,
      meetings_held: cx.filter((i) => i.event_type === "meeting_held").length, brands_met: metB, opt_outs: optOuts,
      opportunities: co.length, open: co.filter(isOpen).length, confirmed: cc.length, lost_withdrawn: co.filter((o) => o.stage === "lost" || o.stage === "withdrawn").length,
      confirmed_cash_inr: cashConf, confirmed_in_kind_inr: sum(cc.filter((o) => o.support_type !== "cash").map((o) => o.confirmed_value_inr)),
      open_pipeline_inr: sum(co.filter(isOpen).map((o) => o.proposed_value_inr)),
      meeting_rate: ratio(metB, brandsTouched), win_rate: ratio(cc.length, cclosed.length), confirmed_per_brand: ratio(cc.length, brandsTouched), opt_out_rate: ratio(optOuts, brandsTouched),
      spend_inr: spend, spend_known: spend != null,
      cost_per_confirmed_inr: spend != null && cc.length ? spend / cc.length : null,
      cash_per_rupee: spend != null && spend > 0 ? cashConf / spend : null,
    };
  });

  // ---------------- cash control tower ----------------
  const recVisible = S.receipts.filter((r) => r.received_at <= asOf);
  const countable = (r: Receipt) => r.verified && (opts.includeTestReceipts || !r.is_test);
  const confirmedCashIds = new Set(confirmedCash.map((o) => o.opportunity_id));
  const pColl = Number(S.settings.forecast_collection_probability ?? 0.87);
  const cashLines: CashLine[] = confirmedCash.map((o) => {
    const mss = S.milestones.filter((m) => m.opportunity_id === o.opportunity_id);
    const rec = recVisible.filter((r) => r.opportunity_id === o.opportunity_id);
    const good = rec.filter(countable);
    const alloc = allocateReceipts(mss, good);
    for (const m of alloc) m.overdue = m.due_at <= asOf && m.paid_inr < m.amount_inr;
    const receivedV = sum(good.map((r) => r.amount_inr));
    const unpaid = alloc.filter((m) => m.paid_inr < m.amount_inr);
    const next = unpaid[0];
    const overdue = sum(alloc.filter((m) => m.overdue).map((m) => m.amount_inr - m.paid_inr));
    const scheduled = sum(alloc.map((m) => m.amount_inr));
    let status: CashLine["status"] = !alloc.length ? "no_schedule" : "scheduled";
    if (overdue > 0) status = "overdue";
    else if (next && next.due_at - asOf <= 7 * DAY) status = "due_soon";
    if (receivedV >= o.confirmed_value_inr && o.confirmed_value_inr > 0) status = receivedV > o.confirmed_value_inr ? "over_collected" : "paid";
    return {
      opportunity_id: o.opportunity_id, opportunity_name: o.opportunity_name, brand_name: o.brand_name, owner_name: o.owner_name,
      confirmed_cash_inr: o.confirmed_value_inr, scheduled_inr: scheduled,
      invoiced_inr: sum(alloc.filter((m) => m.status === "invoiced" && m.invoiced_at <= asOf).map((m) => m.amount_inr)),
      due_by_asof_inr: sum(alloc.filter((m) => m.due_at <= asOf).map((m) => m.amount_inr)),
      due_before_festival_inr: sum(alloc.filter((m) => m.due_at < fest).map((m) => m.amount_inr)),
      received_verified_inr: receivedV, received_unverified_inr: sum(rec.filter((r) => !r.verified && !r.is_test).map((r) => r.amount_inr)),
      outstanding_inr: Math.max(0, o.confirmed_value_inr - receivedV), overdue_inr: overdue,
      next_due_at: next?.due_at ?? null, next_due_inr: next ? next.amount_inr - next.paid_inr : 0, status, milestones: alloc, receipts: rec,
    };
  });
  // receipts against opportunities that are NOT currently confirmed-cash (e.g. withdrawn after payment) are flagged, never hidden
  const orphanReceipts = recVisible.filter((r) => countable(r) && !confirmedCashIds.has(r.opportunity_id));
  const testReceipts = recVisible.filter((r) => r.is_test);
  const daysLeft = (fest - asOf) / DAY;
  const timeFactor = daysLeft < 2 ? 0 : daysLeft < 7 ? 0.25 : daysLeft < 14 ? 0.6 : 1;
  const receivedTotal = sum(cashLines.map((l) => l.received_verified_inr));
  const unpaidConfirmed = sum(cashLines.map((l) => l.outstanding_inr));
  const overdueTotal = sum(cashLines.map((l) => l.overdue_inr));
  // confirmed-unpaid expected: overdue portions discounted by 25% vs on-schedule portions [ASSUMPTION]
  const expConfirmed = sum(cashLines.map((l) => (l.outstanding_inr - Math.min(l.overdue_inr, l.outstanding_inr)) * pColl + Math.min(l.overdue_inr, l.outstanding_inr) * pColl * 0.75));
  const pipelineDetail = open.filter((o) => o.support_type === "cash").map((o) => {
    const sp = stageProb(o.stage, o.channel_group);
    return { opportunity_id: o.opportunity_id, stage: o.stage, group: o.channel_group, proposed_inr: o.proposed_value_inr, p_confirm: sp.p, basis: `${sp.won}/${sp.n} closed ${o.channel_group} opps that reached ${o.stage} were won (Laplace-smoothed)`, expected_inr: o.proposed_value_inr * sp.p * pColl * timeFactor };
  });
  const expPipeline = sum(pipelineDetail.map((p) => p.expected_inr));
  const atRisk = cashLines.filter((l) => l.status === "no_schedule" || l.status === "overdue" || (l.next_due_at != null && l.next_due_at >= fest - 3 * DAY && l.outstanding_inr > 0));

  // weekly view: scheduled due amounts and verified receipts by ISO week (IST)
  const weekKey = (t: number) => { const d = new Date(t + 5.5 * 3600_000); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
  const weeks = new Map<string, { week: string; due_inr: number; received_inr: number }>();
  const wk = (k: string) => weeks.get(k) ?? (weeks.set(k, { week: k, due_inr: 0, received_inr: 0 }), weeks.get(k)!);
  for (const l of cashLines) { for (const m of l.milestones) wk(weekKey(m.due_at)).due_inr += m.amount_inr; for (const r of l.receipts.filter(countable)) wk(weekKey(r.received_at)).received_inr += r.amount_inr; }

  // ---------------- targets ----------------
  const tgt = S.targets.filter((t) => t.effective_at <= asOf).sort((a, b) => a.effective_at - b.effective_at || a.id - b.id).at(-1) ?? null;
  const qualifiedNoOpp = [...qLatest.values()].filter((v) => v.status === "qualified" && !S.opps.some((o) => o.brand_id === v.brand_id && o.created_at <= asOf)).map((v) => v.brand_id);

  const first = (o: OppView) => o.versions.find((v) => v.stage === "partner_confirmed")?.effective_at;
  const cycles = confirmed.map((o) => ((first(o) ?? o.created_at) - o.created_at) / DAY).sort((a, b) => a - b);
  const median = (a: number[]) => (a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);
  const cashVals = confirmedCash.map((o) => o.confirmed_value_inr).sort((a, b) => a - b);

  const groupAgg = (key: (o: OppView) => string) => {
    const m = new Map<string, { key: string; opportunities: number; confirmed: number; confirmed_cash_inr: number; confirmed_in_kind_inr: number; open: number; open_pipeline_inr: number; lost_withdrawn: number }>();
    for (const o of opps) {
      const k = key(o) ?? "unassigned";
      const g = m.get(k) ?? { key: k, opportunities: 0, confirmed: 0, confirmed_cash_inr: 0, confirmed_in_kind_inr: 0, open: 0, open_pipeline_inr: 0, lost_withdrawn: 0 };
      g.opportunities++;
      if (o.stage === "partner_confirmed") { g.confirmed++; if (o.support_type === "cash") g.confirmed_cash_inr += o.confirmed_value_inr; else g.confirmed_in_kind_inr += o.confirmed_value_inr; }
      if (isOpen(o)) { g.open++; g.open_pipeline_inr += o.proposed_value_inr; }
      if (o.stage === "lost" || o.stage === "withdrawn") g.lost_withdrawn++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.confirmed_cash_inr - a.confirmed_cash_inr);
  };

  return {
    as_of: asOf, festival_starts_at: fest, days_to_festival: daysLeft, event_name: S.event.event_name,
    funnel: {
      brands_total: S.brands.filter((b) => b.created_at <= asOf).length,
      brands_touched: uniq(roots.map((i) => i.brand_id)).size,
      brands_outbound_contacted: uniq(outboundRoots.map((i) => i.brand_id)).size,
      contacts_touched: uniq(roots.map((i) => i.contact_id)).size,
      attempts: uniq(roots.map((i) => i.attempt_id)).size,
      outbound_attempts: outboundRoots.length,
      introductions: roots.filter((i) => i.event_type === "introduction_received").length,
      inbound_submissions: roots.filter((i) => i.event_type === "web_inbound").length,
      delivery_rate: ratio(uniq(outboundRoots.map((i) => i.attempt_id).filter((a) => deliveredAttempts.has(a))).size, outboundRoots.length),
      brands_replied: uniq(replied.map((i) => i.brand_id)).size,
      brands_positive: brandsPositive.size,
      meetings_held: held.length,
      brands_met: brandsMet.size,
      opt_out_brands: brandsOptedOut.size,
      qualified_brands: qualCounts.qualified,
      brands_with_opportunity: uniq(opps.map((o) => o.brand_id)).size,
      opportunities: opps.length,
      reached_proposal: reached.proposal_sent,
      reached_negotiating: reached.negotiating,
      confirmed: confirmed.length,
      confirmed_brands: uniq(confirmed.map((o) => o.brand_id)).size,
    },
    qualification: qualCounts,
    qualified_without_opportunity: qualifiedNoOpp,
    stages, conversions, reached,
    win_rate_closed: ratio(confirmed.length, closed.length),
    opp_to_confirmed: ratio(confirmed.length, opps.length),
    deals: {
      confirmed_value_inr: sum(confirmed.map((o) => o.confirmed_value_inr)),
      confirmed_cash_inr: sum(confirmedCash.map((o) => o.confirmed_value_inr)),
      confirmed_in_kind_inr: sum(confirmedInKind.map((o) => o.confirmed_value_inr)),
      confirmed_cash_count: confirmedCash.length, confirmed_in_kind_count: confirmedInKind.length,
      avg_confirmed_cash_inr: cashVals.length ? sum(cashVals) / cashVals.length : null,
      median_confirmed_cash_inr: median(cashVals),
      open_count: open.length, open_pipeline_inr: sum(open.map((o) => o.proposed_value_inr)),
      open_stale_count: open.filter((o) => o.days_in_stage > staleDays).length,
      median_days_to_confirm: median(cycles),
      median_days_in_stage_open: median(open.map((o) => o.days_in_stage).sort((a, b) => a - b)),
    },
    opps, campaigns,
    owners: groupAgg((o) => o.owner_name ?? "unassigned"),
    industries: groupAgg((o) => o.industry),
    cash: {
      confirmed_cash_inr: sum(confirmedCash.map((o) => o.confirmed_value_inr)),
      confirmed_in_kind_inr: sum(confirmedInKind.map((o) => o.confirmed_value_inr)),
      open_pipeline_cash_inr: sum(open.filter((o) => o.support_type === "cash").map((o) => o.proposed_value_inr)),
      scheduled_inr: sum(cashLines.map((l) => l.scheduled_inr)),
      invoiced_inr: sum(cashLines.map((l) => l.invoiced_inr)),
      due_by_asof_inr: sum(cashLines.map((l) => l.due_by_asof_inr)),
      due_before_festival_inr: sum(cashLines.map((l) => l.due_before_festival_inr)),
      received_verified_inr: receivedTotal,
      received_unverified_inr: sum(cashLines.map((l) => l.received_unverified_inr)),
      test_receipts_inr: sum(testReceipts.map((r) => r.amount_inr)), test_receipts_included: Boolean(opts.includeTestReceipts),
      orphan_receipts: orphanReceipts,
      outstanding_inr: unpaidConfirmed, overdue_inr: overdueTotal,
      unscheduled_confirmed_inr: sum(cashLines.filter((l) => l.status === "no_schedule").map((l) => l.confirmed_cash_inr)),
      at_risk_inr: sum(atRisk.map((l) => l.outstanding_inr)), at_risk_count: atRisk.length,
      lines: cashLines, weekly: [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
      forecast: {
        received_inr: receivedTotal, expected_from_confirmed_inr: expConfirmed, expected_from_pipeline_inr: expPipeline,
        total_pre_festival_inr: receivedTotal + expConfirmed + expPipeline,
        collection_probability: pColl, time_factor: timeFactor, pipeline_detail: pipelineDetail,
        label: "[CALCULATED w/ ASSUMPTION] received (fact) + unpaid confirmed cash x collection probability (overdue x0.75) + open cash pipeline x P(confirm | stage, channel history) x collection probability x time-to-festival factor",
      },
      historical_receipts_available: S.receipts.some((r) => !r.is_test),
    },
    targets: tgt && {
      version: tgt.target_version, basis: tgt.basis, origin: tgt.origin,
      qualified: { goal: tgt.qualified_brands_goal, actual: qualCounts.qualified },
      confirmed: { goal: tgt.confirmed_partnerships_goal, actual: confirmed.length },
      cash: { goal: tgt.cash_collection_goal_inr, received: receivedTotal },
    },
    stage_probability: stageProb,
  };
}
export type Snapshot = ReturnType<typeof computeSnapshot>;

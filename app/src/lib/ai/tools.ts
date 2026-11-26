/**
 * Controlled query layer for the AI Growth Analyst. The model can ONLY call these functions.
 * No SQL, no writes (propose_task returns a draft that a human must confirm in the UI).
 * Every result is recomputed from the live database on each call and carries as_of + record IDs.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client";
import { loadState, type State } from "../analytics/state";
import { computeSnapshot, type Snapshot } from "../analytics/snapshot";
import { readinessQueue, READINESS_RULES } from "../analytics/readiness";
import { evaluateThresholds } from "../analytics/thresholds";
import { runScenario, waterfall, ASSUMPTIONS, type Overrides } from "../model/engine";
import { clock, getSetting } from "../services";

const inr = (n: number | null | undefined) => (n == null ? null : Math.round(n));
const pct = (r: { value: number | null; num: number; den: number }) => ({ value: r.value == null ? null : Math.round(r.value * 1000) / 1000, numerator: r.num, denominator: r.den });
const iso = (t: number | null) => (t == null || Number.isNaN(t) ? null : new Date(t + 5.5 * 3600_000).toISOString().replace("Z", "+05:30"));

export interface Ctx { db: Db; S: State; snap: Snapshot; asOf: number; staleDays: number }
export async function buildCtx(db: Db): Promise<Ctx> {
  const S = await loadState(db);
  const asOf = await clock(db);
  return { db, S, snap: computeSnapshot(S, asOf), asOf, staleDays: await getSetting<number>(db, "stale_days") };
}

export const DATA_GAPS: Record<string, string> = {
  historical_receipts: "The original 2025 dataset contains NO bank receipts, invoices or payment dates. Historical cash collected is UNKNOWN. Confirmed value is a commitment, not cash.",
  campaign_spend: "The original dataset contains NO campaign budget or spend. Historical CAC, cost per partnership and ROI cannot be calculated unless spend is entered in SponsorOS.",
  causality: "Campaign attribution is observational (originating campaign recorded at opportunity creation). It cannot prove that a campaign caused a partnership.",
  loss_reasons: "Lost/withdrawn opportunities have no recorded loss reason.",
  attendee_numbers: "This is the sponsorship dataset. It has 3 sponsor-to-attendee-campaign activation links but no attendee counts, footfall or activation results.",
  sponsor_budgets: "Brand marketing budgets, contract documents, GST/tax, and sponsor satisfaction are not recorded.",
  contact_channels: "Source contacts have no email/phone. Contacts created in SponsorOS may have email.",
  future_edition: "Forecasts for the next edition come from model/assumptions.json (labelled [ASSUMPTION]/[CALCULATED]); they are not actuals.",
};

function oppBrief(o: Snapshot["opps"][number]) {
  return { opportunity_id: o.opportunity_id, brand: o.brand_name, brand_id: o.brand_id, stage: o.stage, support_type: o.support_type, proposed_inr: o.proposed_value_inr, confirmed_inr: o.confirmed_value_inr, owner: o.owner_name, campaign: o.campaign_name, channel_group: o.channel_group, days_in_stage: Math.round(o.days_in_stage), brand_met: o.brand_met, brand_qualification: o.brand_qualification };
}

type ToolFn = (ctx: Ctx, input: Record<string, unknown>) => Promise<unknown> | unknown;
interface ToolDef { schema: Anthropic.Tool; run: ToolFn }

const T = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Tool => ({
  name, description, input_schema: { type: "object", properties, required, additionalProperties: false } as Anthropic.Tool.InputSchema,
});

export const TOOLS: Record<string, ToolDef> = {
  get_overview: {
    schema: T("get_overview", "Headline position as of the operating clock: funnel counts, confirmed commitments (cash-type vs in-kind), verified cash received, outstanding, forecast, targets vs actuals, data gaps. Call first for any 'where are we' question."),
    run: ({ snap, S }) => ({
      as_of: iso(snap.as_of), event: snap.event_name, festival_starts_at: iso(snap.festival_starts_at), days_to_festival: Math.round(snap.days_to_festival * 10) / 10,
      funnel: snap.funnel, qualification: snap.qualification,
      deals: { ...snap.deals, avg_confirmed_cash_inr: inr(snap.deals.avg_confirmed_cash_inr) },
      cash: { confirmed_cash_type_inr: snap.cash.confirmed_cash_inr, confirmed_in_kind_inr_NOT_CASH: snap.cash.confirmed_in_kind_inr, verified_received_inr: snap.cash.received_verified_inr, unverified_receipts_inr: snap.cash.received_unverified_inr, test_receipts_excluded_inr: snap.cash.test_receipts_inr, outstanding_inr: snap.cash.outstanding_inr, overdue_inr: snap.cash.overdue_inr, unscheduled_confirmed_inr: snap.cash.unscheduled_confirmed_inr, forecast_pre_festival_inr: inr(snap.cash.forecast.total_pre_festival_inr), forecast_method: snap.cash.forecast.label, any_non_test_receipts_recorded: snap.cash.historical_receipts_available },
      targets: snap.targets, win_rate_closed: pct(snap.win_rate_closed),
      data_gaps: snap.cash.historical_receipts_available ? [DATA_GAPS.campaign_spend] : [DATA_GAPS.historical_receipts, DATA_GAPS.campaign_spend],
      source: S.source ? { file: S.source.file_name, sha256: S.source.sha256.slice(0, 12) } : null,
    }),
  },
  get_funnel: {
    schema: T("get_funnel", "Stage-by-stage opportunity funnel with explicit numerator/denominator, optionally for one campaign or channel group. Also brand-level top-of-funnel counts.", { campaign_id: { type: "string", description: "e.g. SC01" }, channel_group: { type: "string", enum: ["warm", "cold"] } }),
    run: ({ snap }, i) => {
      const opps = snap.opps.filter((o) => (!i.campaign_id || o.campaign_id === i.campaign_id) && (!i.channel_group || o.channel_group === i.channel_group));
      const order = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed"];
      const reached = order.map((st) => ({ stage: st, opportunities_ever_reached: opps.filter((o) => o.versions.some((v) => v.stage === st)).length }));
      return {
        as_of: iso(snap.as_of), filter: i, definition: "Counts opportunities whose history (<= as_of) ever reached each stage. Conversion = reached(next)/reached(stage).",
        reached, conversions: reached.slice(0, -1).map((r, k) => ({ from: r.stage, to: reached[k + 1].stage, value: r.opportunities_ever_reached ? +(reached[k + 1].opportunities_ever_reached / r.opportunities_ever_reached).toFixed(3) : null, numerator: reached[k + 1].opportunities_ever_reached, denominator: r.opportunities_ever_reached })),
        current_stage_counts: Object.fromEntries(["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"].map((st) => [st, opps.filter((o) => o.stage === st).length])),
        brand_level: i.campaign_id || i.channel_group ? undefined : { brands_touched: snap.funnel.brands_touched, brands_replied: snap.funnel.brands_replied, brands_positive: snap.funnel.brands_positive, brands_met: snap.funnel.brands_met, qualified_brands: snap.funnel.qualified_brands, brands_with_opportunity: snap.funnel.brands_with_opportunity, confirmed_brands: snap.funnel.confirmed_brands },
        opportunity_ids: opps.map((o) => o.opportunity_id),
      };
    },
  },
  compare_campaigns: {
    schema: T("compare_campaigns", "Per-campaign performance: attempts, brands touched, meetings, opportunities, confirmed (count, cash-type INR, in-kind INR), win rate, confirmed per brand, opt-outs, open pipeline, spend (if recorded) and cost per confirmed. Sorted by the chosen metric.", { sort_by: { type: "string", enum: ["confirmed_cash_inr", "confirmed_per_brand", "meeting_rate", "win_rate", "open_pipeline_inr", "brands_touched"] } }),
    run: ({ snap }, i) => {
      const key = String(i.sort_by ?? "confirmed_cash_inr");
      const val = (c: Snapshot["campaigns"][number]) => { const v = (c as unknown as Record<string, unknown>)[key]; return typeof v === "number" ? v : (v as { value: number | null })?.value ?? -1; };
      return {
        as_of: iso(snap.as_of), caveat: DATA_GAPS.causality,
        campaigns: [...snap.campaigns].sort((a, b) => val(b) - val(a)).map((c) => ({ id: c.id, name: c.name, channel: c.channel, group: c.channel_group, status: c.status, owner: c.owner_name, initiative: c.initiative_id, attempts: c.attempts, brands_touched: c.brands_touched, brands_met: c.brands_met, meeting_rate: pct(c.meeting_rate), opportunities: c.opportunities, confirmed: c.confirmed, win_rate_closed: pct(c.win_rate), confirmed_per_brand: pct(c.confirmed_per_brand), confirmed_cash_inr: c.confirmed_cash_inr, confirmed_in_kind_inr: c.confirmed_in_kind_inr, open: c.open, open_pipeline_inr: c.open_pipeline_inr, lost_withdrawn: c.lost_withdrawn, opt_outs: c.opt_outs, budget_inr: c.budget_inr, spend_inr: c.spend_known ? c.spend_inr : "NOT RECORDED", cost_per_confirmed_inr: c.spend_known ? inr(c.cost_per_confirmed_inr) : "NOT CALCULABLE" })),
      };
    },
  },
  list_opportunities: {
    schema: T("list_opportunities", "Filter opportunities (latest stage as of the clock). Use for stale/aging deals, largest negotiating deals, deals by owner/campaign.", { stage: { type: "string", enum: ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn", "open"] }, campaign_id: { type: "string" }, owner: { type: "string", description: "owner name or id" }, channel_group: { type: "string", enum: ["warm", "cold"] }, stale_only: { type: "boolean", description: "only open deals in stage longer than the stale threshold" }, min_value_inr: { type: "number" }, sort_by: { type: "string", enum: ["value", "days_in_stage"] }, limit: { type: "number" } }),
    run: ({ snap, staleDays }, i) => {
      const open = ["prospecting", "contacted", "proposal_sent", "negotiating"];
      let r = snap.opps.filter((o) => (!i.stage || (i.stage === "open" ? open.includes(o.stage) : o.stage === i.stage)) && (!i.campaign_id || o.campaign_id === i.campaign_id) && (!i.channel_group || o.channel_group === i.channel_group) && (!i.min_value_inr || o.proposed_value_inr >= Number(i.min_value_inr)) && (!i.owner || [o.owner_name, o.owner_id].some((x) => x && x.toLowerCase().includes(String(i.owner).toLowerCase()))) && (!i.stale_only || (open.includes(o.stage) && o.days_in_stage > staleDays)));
      r = r.sort((a, b) => (i.sort_by === "days_in_stage" ? b.days_in_stage - a.days_in_stage : b.proposed_value_inr - a.proposed_value_inr));
      return { as_of: iso(snap.as_of), stale_threshold_days: staleDays, total_matching: r.length, total_proposed_inr: r.reduce((a, o) => a + o.proposed_value_inr, 0), opportunities: r.slice(0, Number(i.limit ?? 25)).map(oppBrief) };
    },
  },
  get_entity: {
    schema: T("get_entity", "Look up one brand, opportunity, campaign or team member by ID (A001, O012, SC03, T01) or name (fuzzy). Returns full detail: stage history, interactions timeline, qualification, cash schedule/receipts, related tasks.", { query: { type: "string" } }, ["query"]),
    run: ({ snap, S }, i) => {
      const q = String(i.query).trim().toLowerCase();
      const opp = snap.opps.find((o) => o.opportunity_id.toLowerCase() === q) ?? snap.opps.find((o) => o.opportunity_name.toLowerCase() === q);
      const brand = S.brands.find((b) => b.brand_id.toLowerCase() === q) ?? S.brands.find((b) => b.brand_name.toLowerCase() === q) ?? (opp ? S.brands.find((b) => b.brand_id === opp.brand_id) : undefined) ?? S.brands.find((b) => b.brand_name.toLowerCase().includes(q) || q.includes(b.brand_name.toLowerCase()));
      const camp = snap.campaigns.find((c) => c.id.toLowerCase() === q || c.name.toLowerCase() === q || c.name.toLowerCase().includes(q));
      if (!brand && camp) return { type: "campaign", as_of: iso(snap.as_of), campaign: camp, tasks: S.tasks.filter((t) => t.campaign_id === camp.id) };
      const member = Object.entries(S.team).find(([id, n]) => id.toLowerCase() === q || n.toLowerCase().includes(q));
      if (!brand && member) return { type: "team_member", id: member[0], name: member[1], opportunities: snap.opps.filter((o) => o.owner_id === member[0]).map(oppBrief), tasks: S.tasks.filter((t) => t.owner_id === member[0]) };
      if (!brand) return { found: false, message: `No brand, opportunity, campaign or team member matches '${i.query}'.` };
      const opps = snap.opps.filter((o) => o.brand_id === brand.brand_id);
      const ix = S.interactions.filter((x) => x.brand_id === brand.brand_id && x.occurred_at <= snap.as_of).sort((a, b) => a.occurred_at - b.occurred_at);
      return {
        type: "brand", as_of: iso(snap.as_of), brand: { ...brand, created_at: iso(brand.created_at), owner: S.team[brand.owner_id ?? ""] ?? null },
        qualification_history: S.qual.filter((v) => v.brand_id === brand.brand_id && v.effective_at <= snap.as_of).sort((a, b) => a.effective_at - b.effective_at).map((v) => ({ id: v.history_id, status: v.status, reason: v.reason, at: iso(v.effective_at) })),
        contacts: S.contacts.filter((c) => c.brand_id === brand.brand_id).map((c) => ({ id: c.contact_id, name: c.contact_name, title: c.job_title })),
        interactions: ix.map((x) => ({ id: x.interaction_id, attempt: x.attempt_id, type: x.event_type, outcome: x.outcome, campaign: x.campaign_id, at: iso(x.occurred_at) })),
        opportunities: opps.map((o) => ({ ...oppBrief(o), history: o.versions.map((v) => ({ id: v.history_id, stage: v.stage, proposed: v.proposed_value_inr, confirmed: v.confirmed_value_inr, at: iso(v.effective_at) })), cash: snap.cash.lines.find((l) => l.opportunity_id === o.opportunity_id) ?? (o.support_type === "in_kind" ? "in-kind: no cash" : null) })),
        tasks: S.tasks.filter((t) => t.brand_id === brand.brand_id || opps.some((o) => o.opportunity_id === t.opportunity_id)),
      };
    },
  },
  get_cash_position: {
    schema: T("get_cash_position", "Cash Conversion Control Tower: confirmed cash-type vs in-kind, scheduled, invoiced, due, VERIFIED received, outstanding, overdue, at-risk lines, weekly schedule, and the pre-festival cash forecast with its method and pipeline detail."),
    run: ({ snap }) => {
      const c = snap.cash;
      return {
        as_of: iso(snap.as_of), definitions: { received: "verified, non-test receipts dated <= as_of", outstanding: "confirmed cash-type value - verified received", in_kind: "never counted as cash" },
        totals: { confirmed_cash_type_inr: c.confirmed_cash_inr, confirmed_in_kind_inr: c.confirmed_in_kind_inr, scheduled_inr: c.scheduled_inr, invoiced_inr: c.invoiced_inr, due_by_as_of_inr: c.due_by_asof_inr, due_before_festival_inr: c.due_before_festival_inr, verified_received_inr: c.received_verified_inr, unverified_received_inr: c.received_unverified_inr, test_receipts_excluded_inr: c.test_receipts_inr, outstanding_inr: c.outstanding_inr, overdue_inr: c.overdue_inr, unscheduled_confirmed_inr: c.unscheduled_confirmed_inr, at_risk_inr: c.at_risk_inr, at_risk_count: c.at_risk_count, cash_goal_inr: snap.targets?.cash.goal ?? null },
        forecast: { ...c.forecast, pipeline_detail: c.forecast.pipeline_detail.slice(0, 15).map((p) => ({ ...p, expected_inr: inr(p.expected_inr), p_confirm: +p.p_confirm.toFixed(3) })), expected_from_confirmed_inr: inr(c.forecast.expected_from_confirmed_inr), expected_from_pipeline_inr: inr(c.forecast.expected_from_pipeline_inr), total_pre_festival_inr: inr(c.forecast.total_pre_festival_inr) },
        lines: c.lines.map((l) => ({ opportunity_id: l.opportunity_id, brand: l.brand_name, confirmed_cash_inr: l.confirmed_cash_inr, scheduled_inr: l.scheduled_inr, received_inr: l.received_verified_inr, outstanding_inr: l.outstanding_inr, overdue_inr: l.overdue_inr, status: l.status, next_due: iso(l.next_due_at) })),
        orphan_receipts: c.orphan_receipts, weekly: c.weekly,
        historical_receipts_note: c.historical_receipts_available ? "Some non-test receipts are recorded in SponsorOS." : DATA_GAPS.historical_receipts,
      };
    },
  },
  get_readiness_queue: {
    schema: T("get_readiness_queue", "Explainable Sponsor Cash Readiness Engine: rule-based 0-100 score per open or confirmed-cash deal with the next best action and the exact factors behind it. Use for 'which sponsors need intervention', 'what should we do today', 'next best action'.", { track: { type: "string", enum: ["collection", "closing"] }, limit: { type: "number" }, opportunity_id: { type: "string" } }),
    run: ({ snap, staleDays }, i) => {
      let q = readinessQueue(snap, staleDays);
      if (i.track) q = q.filter((x) => x.track === i.track);
      if (i.opportunity_id) q = q.filter((x) => x.opportunity_id === i.opportunity_id);
      return { as_of: iso(snap.as_of), method: "Rule-based heuristic, NOT a trained probability.", rules: READINESS_RULES, items: q.slice(0, Number(i.limit ?? 12)).map((x) => ({ ...x, urgency: Math.round(x.urgency) })) };
    },
  },
  get_threshold_signals: {
    schema: T("get_threshold_signals", "Evaluate the approved scale/change/stop thresholds (stored in the app, editable) against live metrics for each initiative and each campaign. Returns signal, evidence and the pre-agreed response."),
    run: ({ S, snap }) => ({ as_of: iso(snap.as_of), signals: evaluateThresholds(S, snap) }),
  },
  get_initiatives_plan: {
    schema: T("get_initiatives_plan", "The approved next-edition plan: five ranked initiatives with budget, timeline, KPIs, thresholds, expected incremental pre-festival cash (waterfall, no double counting), deprioritised ideas, and current initiative status/owners/tasks.", { level: { type: "string", enum: ["base", "stretch"] } }),
    run: ({ S }, i) => {
      const level = (i.level as "base" | "stretch") ?? "base";
      const wf = waterfall(level);
      return {
        label: "[SIMULATION]/[ASSUMPTION] forward-looking plan, not actuals", level,
        waterfall: wf.map((w) => ({ ...w, collected_inr: inr(w.collected_inr), increment_inr: inr(w.increment_inr), signed: +w.signed.toFixed(1) })),
        initiatives: S.initiatives.map((x) => ({ id: x.id, rank: x.rank, name: x.name, status: x.status, owner: S.team[x.owner_id ?? ""] ?? null, budget_inr: x.budget_inr, definition: x.definition, open_tasks: S.tasks.filter((t) => t.initiative_id === x.id && t.status !== "done" && t.status !== "cancelled").length })),
        deprioritised: ASSUMPTIONS.deprioritised,
      };
    },
  },
  run_scenario: {
    schema: T("run_scenario", "Run the next-edition cash forecast model with overrides (never touches actual records). E.g. collection rate falls 10pp => collection_prob_delta=-0.10; win rates 20% lower => win_multiplier=0.8.", {
      level: { type: "string", enum: ["base", "stretch"] }, collection_prob_delta: { type: "number" }, win_multiplier: { type: "number" }, deal_multiplier: { type: "number" }, warm_prospects_multiplier: { type: "number" }, prospects_multiplier: { type: "number" }, conversation_multiplier: { type: "number" }, proposal_multiplier: { type: "number" }, closers: { type: "number" }, withdrawal: { type: "number" }, cash_share: { type: "number" }, collection_desk: { type: "boolean" }, cold_prospects: { type: "number" }, attach: { type: "number" },
    }),
    run: (_c, i) => {
      const { level, ...o } = i as { level?: "base" | "stretch" } & Overrides;
      const r = runScenario(level ?? "base", o);
      return { label: r.label, level: r.level, overrides: o, collected_inr: inr(r.totals.collected_inr), plan_default_collected_inr: inr(r.plan_default_collected_inr), delta_vs_plan_inr: inr(r.delta_vs_plan_inr), signed_deals_expected: +r.totals.signed.toFixed(1), committed_inr: inr(r.totals.committed_inr), cash_type_inr: inr(r.totals.cash_type_inr), in_kind_inr: inr(r.totals.in_kind_inr), collection_rate: +r.totals.collection_rate.toFixed(3), capacity_binding: r.totals.capacity_binding, proposals: +r.totals.proposals.toFixed(1), capacity_proposals: r.totals.capacity_proposals, by_source: r.rows.map((x) => ({ id: x.id, signed: +x.signed.toFixed(2), collected_inr: inr(x.collected_inr) })) };
    },
  },
  get_tasks: {
    schema: T("get_tasks", "List execution tasks with owner, due date, status, linked opportunity/brand/campaign/initiative and originating recommendation.", { status: { type: "string", enum: ["open", "in_progress", "done", "cancelled", "active"] }, owner: { type: "string" }, overdue_only: { type: "boolean" } }),
    run: ({ S, snap }, i) => {
      const r = S.tasks.filter((t) => (!i.status || (i.status === "active" ? ["open", "in_progress"].includes(t.status) : t.status === i.status)) && (!i.owner || (S.team[t.owner_id ?? ""] ?? "").toLowerCase().includes(String(i.owner).toLowerCase()) || t.owner_id === i.owner) && (!i.overdue_only || (["open", "in_progress"].includes(t.status) && t.due_at < snap.as_of)));
      return { as_of: iso(snap.as_of), count: r.length, tasks: r.map((t) => ({ id: t.id, title: t.title, owner: S.team[t.owner_id ?? ""] ?? null, status: t.status, priority: t.priority, due: iso(t.due_at), overdue: ["open", "in_progress"].includes(t.status) && t.due_at < snap.as_of, opportunity_id: t.opportunity_id, brand_id: t.brand_id, campaign_id: t.campaign_id, initiative_id: t.initiative_id, recommendation_id: t.recommendation_id, created_by: t.created_by, outcome: t.outcome })) };
    },
  },
  get_breakdown: {
    schema: T("get_breakdown", "Performance by opportunity owner or by brand industry: opportunities, confirmed, cash-type and in-kind confirmed value, open pipeline, lost/withdrawn.", { by: { type: "string", enum: ["owner", "industry"] } }, ["by"]),
    run: ({ snap }, i) => ({ as_of: iso(snap.as_of), by: i.by, rows: i.by === "owner" ? snap.owners : snap.industries }),
  },
  check_data_availability: {
    schema: T("check_data_availability", "Check whether the data needed to answer a question exists (receipts, spend/ROI/CAC, causality, loss reasons, attendee numbers, sponsor budgets, contact channels, future-edition forecasts). Call BEFORE answering anything that may rely on missing data.", { topic: { type: "string" } }, ["topic"]),
    run: ({ S }, i) => {
      const t = String(i.topic).toLowerCase();
      const keys = Object.keys(DATA_GAPS).filter((k) => k.split("_").some((w) => t.includes(w.slice(0, 5))) || (/(roi|cac|cost|spend|budget|return)/.test(t) && k === "campaign_spend") || (/(cash|receipt|collect|paid|payment|bank)/.test(t) && k === "historical_receipts") || (/(cause|caus|impact|uplift|attribut)/.test(t) && k === "causality") || (/(attendee|footfall|visitor)/.test(t) && k === "attendee_numbers") || (/(why.*lost|loss reason|lost)/.test(t) && k === "loss_reasons"));
      const spendCampaigns = new Set(S.spend.map((s) => s.campaign_id));
      return { topic: i.topic, relevant_gaps: (keys.length ? keys : Object.keys(DATA_GAPS)).map((k) => ({ gap: k, detail: DATA_GAPS[k] })), app_recorded: { receipts_non_test: S.receipts.filter((r) => !r.is_test).length, receipts_test: S.receipts.filter((r) => r.is_test).length, campaigns_with_spend: [...spendCampaigns], payment_milestones: S.milestones.length } };
    },
  },
  propose_task: {
    schema: T("propose_task", "Draft a trackable task from an insight. This DOES NOT save anything: the user must review and confirm it in the UI. Include the issue, the evidence (numbers + record IDs from tool results), diagnosis and expected impact.", {
      title: { type: "string" }, description: { type: "string" }, owner_id: { type: "string", description: "team member id, e.g. T01" }, due_in_days: { type: "number", description: "days after the operating clock" }, priority: { type: "string", enum: ["high", "medium", "low"] },
      opportunity_id: { type: "string" }, brand_id: { type: "string" }, campaign_id: { type: "string" }, initiative_id: { type: "string" },
      issue: { type: "string" }, evidence: { type: "string" }, diagnosis: { type: "string" }, expected_impact: { type: "string" },
    }, ["title", "issue", "evidence"]),
    run: ({ S, snap }, i) => {
      const problems: string[] = [];
      if (i.owner_id && !S.team[String(i.owner_id)]) problems.push(`unknown owner_id ${i.owner_id}`);
      if (i.opportunity_id && !S.opps.some((o) => o.opportunity_id === i.opportunity_id)) problems.push(`unknown opportunity_id ${i.opportunity_id}`);
      if (i.brand_id && !S.brands.some((b) => b.brand_id === i.brand_id)) problems.push(`unknown brand_id ${i.brand_id}`);
      if (i.campaign_id && !S.campaigns.some((c) => c.id === i.campaign_id)) problems.push(`unknown campaign_id ${i.campaign_id}`);
      if (i.initiative_id && !S.initiatives.some((x) => x.id === i.initiative_id)) problems.push(`unknown initiative_id ${i.initiative_id}`);
      if (problems.length) return { ok: false, problems, message: "Proposal rejected by validation; fix the IDs (see get_entity)." };
      const due = snap.as_of + Number(i.due_in_days ?? 2) * 86_400_000;
      const proposal = {
        recommendation: { source: "ai", issue: String(i.issue), evidence: { summary: String(i.evidence), as_of: iso(snap.as_of) }, diagnosis: i.diagnosis ? String(i.diagnosis) : undefined, action: String(i.title), expected_impact: i.expected_impact ? String(i.expected_impact) : undefined },
        task: { title: String(i.title), description: i.description ? String(i.description) : undefined, owner_id: i.owner_id ?? null, due_at: new Date(due).toISOString(), priority: i.priority ?? "medium", opportunity_id: i.opportunity_id ?? null, brand_id: i.brand_id ?? null, campaign_id: i.campaign_id ?? null, initiative_id: i.initiative_id ?? null },
      };
      return { ok: true, status: "PENDING_USER_CONFIRMATION", note: "Not saved. The user must click Confirm.", proposal };
    },
  },
};

export const TOOL_SCHEMAS: Anthropic.Tool[] = Object.values(TOOLS).map((t) => t.schema);
export async function runTool(ctx: Ctx, name: string, input: Record<string, unknown>) {
  const t = TOOLS[name];
  if (!t) return { error: `Unknown tool ${name}` };
  try { return await t.run(ctx, input ?? {}); } catch (e) { return { error: (e as Error).message }; }
}

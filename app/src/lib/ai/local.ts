/**
 * Deterministic analyst used when no LLM key is configured (and as an outage fallback).
 * It is NOT an LLM: it routes the question to the same audited tools, computes from live data,
 * and renders the result with templates. Responses are labelled accordingly in the UI.
 */
import type { Ctx } from "./tools";
import { runTool, DATA_GAPS } from "./tools";
import type { ChatTurn, ToolTrace } from "./analyst";

const R = (n: number | null | undefined) => (n == null ? "n/a" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const P = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ID_RE = /\b(OX\d{4}|O\d{3}|AX\d{4}|A\d{3}|SCX\d{3}|SC\d{2}|T\d{2})\b/gi;

function findEntity(ctx: Ctx, text: string): string | null {
  const ids = text.match(ID_RE);
  if (ids?.length) return ids[ids.length - 1].toUpperCase();
  const t = text.toLowerCase();
  const brands = [...ctx.S.brands].sort((a, b) => b.brand_name.length - a.brand_name.length);
  const b = brands.find((x) => t.includes(x.brand_name.toLowerCase()));
  if (b) return b.brand_id;
  const c = ctx.S.campaigns.find((x) => t.includes(x.name.toLowerCase()));
  if (c) return c.id;
  const m = Object.entries(ctx.S.team).find(([, n]) => t.includes(n.toLowerCase()) || t.includes(n.split(" ")[0].toLowerCase() + " "));
  return m ? m[0] : null;
}

function parseScenario(q: string) {
  const o: Any = {};
  const num = (re: RegExp) => { const m = q.match(re); return m ? parseFloat(m[1]) : null; };
  const down = /(fall|drop|decreas|lower|reduc|declin|down|worse|less)/.test(q);
  const pp = num(/(\d+(?:\.\d+)?)\s*(?:pp|percentage point|points?)/);
  const pc = num(/(\d+(?:\.\d+)?)\s*%/);
  if (/collect/.test(q)) o.collection_prob_delta = ((pp ?? pc ?? 10) / 100) * (down ? -1 : 1);
  if (/win|close rate|conversion/.test(q)) o.win_multiplier = 1 + ((pc ?? pp ?? 20) / 100) * (down ? -1 : 1);
  if (/deal size|deal value|ticket|average deal/.test(q)) o.deal_multiplier = 1 + ((pc ?? 20) / 100) * (down ? -1 : 1);
  if (/referral|warm|alumni|creator|inbound/.test(q) && /volume|lead|prospect|intro|fewer|more/.test(q)) o.warm_prospects_multiplier = 1 + ((pc ?? 30) / 100) * (down ? -1 : 1);
  const cl = num(/(\d+)\s*closers?/); if (cl != null) o.closers = cl; else if (/(one|1) (fewer|less) closer/.test(q)) o.closers = 4; else if (/(one|1) more closer|extra closer|add a closer/.test(q)) o.closers = 6;
  if (/withdraw/.test(q)) o.withdrawal = (pc ?? 10) / 100;
  if (/(no|without|drop|remove).*(collection desk|collections desk)/.test(q)) o.collection_desk = false;
  if (/stretch/.test(q)) o.level = "stretch";
  return o;
}

export async function localAnalyst(ctx: Ctx, history: ChatTurn[]) {
  const tools: ToolTrace[] = [];
  const proposals: unknown[] = [];
  const call = async (name: string, input: Any = {}) => { const out = (await runTool(ctx, name, input)) as Any; tools.push({ name, input, summary: JSON.stringify(out).slice(0, 200) }); return out; };
  const last = history.at(-1)?.content ?? "";
  const q = last.toLowerCase();
  const prior = history.slice(0, -1).map((t) => t.content).join("\n");
  const followUp = /^(and|what about|how about|why|so|ok|then|it|that|this|those|them|same|do it|create|make|add)\b/.test(q.trim()) || q.split(/\s+/).length <= 6;
  let focus = findEntity(ctx, last) ?? (followUp ? findEntity(ctx, prior.split("\n").reverse().join("\n")) : null);
  const asOf = new Date(ctx.asOf + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " IST";
  const out: string[] = [];
  const done = (text: string) => ({ text: `${text}\n\n_Deterministic analyst (no LLM key configured): every figure above is computed from the live database as of ${asOf}._`, provider: "local-deterministic", tools, proposals });

  // ---------- 1. explicit task creation ----------
  if (/(create|make|add|assign|set up|open)\b.*\b(task|action|follow.?up|to-?do)|^(do it|yes,? create)/.test(q)) {
    const rq = (await call("get_readiness_queue", { limit: 60 })).items as Any[];
    let item = focus ? rq.find((x) => x.opportunity_id === focus || ctx.snap.opps.find((o) => o.opportunity_id === x.opportunity_id)?.brand_id === focus) : null;
    if (!item && /(top|first|most urgent|highest|priority)/.test(q + " " + prior.slice(-400).toLowerCase())) item = rq[0];
    if (!item) return done("Which deal or campaign should the task be for? Name a brand, opportunity ID (e.g. O012) or campaign (e.g. SC01), or ask me for the readiness queue first.");
    const opp = ctx.snap.opps.find((o) => o.opportunity_id === item.opportunity_id)!;
    const owner = opp.owner_id ?? ctx.S.brands.find((b) => b.brand_id === opp.brand_id)?.owner_id ?? undefined;
    const p = await call("propose_task", {
      title: `${item.action}: ${opp.brand_name} (${opp.opportunity_id})`, owner_id: owner, due_in_days: item.track === "collection" ? 1 : 2, priority: item.band === "low" && item.track === "closing" ? "medium" : "high",
      opportunity_id: opp.opportunity_id, brand_id: opp.brand_id, initiative_id: item.track === "collection" ? "I1" : undefined,
      issue: `${opp.brand_name} ${item.track === "collection" ? `has ${R(item.value_inr)} confirmed cash outstanding` : `is ${opp.stage} (${R(opp.proposed_value_inr)})`}; readiness ${item.score}/100 (${item.band}).`,
      evidence: item.why, diagnosis: `Next best action from the readiness rules: ${item.action}.`, expected_impact: item.track === "collection" ? `Protects ${R(item.value_inr)} of pre-festival cash.` : `Moves ${R(opp.proposed_value_inr)} of pipeline toward confirmation.`,
    });
    if (p.ok) proposals.push(p.proposal);
    return done(p.ok ? `I drafted a task — **not saved yet**. Review it below and click **Confirm** to create it.\n\n- **${p.proposal.task.title}**\n- Owner: ${ctx.S.team[p.proposal.task.owner_id] ?? "unassigned"} · Due: ${p.proposal.task.due_at.slice(0, 10)} · Priority: ${p.proposal.task.priority}\n- Evidence: ${item.why}` : `I could not draft the task: ${p.problems?.join(", ")}`);
  }

  // ---------- 2. questions the data cannot answer ----------
  if (/\b(roi|cac|return on|cost per|cost of acquisition|spend|spent|payback)\b/.test(q)) {
    const camps = (await call("compare_campaigns", {})).campaigns as Any[];
    const known = camps.filter((c) => typeof c.spend_inr === "number");
    const target = focus ? camps.find((c) => c.id === focus) : null;
    if (target && typeof target.spend_inr !== "number") return done(`**ROI for ${target.name} cannot be calculated.** No spend is recorded for ${target.id} — the original dataset contains no campaign budget or spend (${DATA_GAPS.campaign_spend})\n\nWhat the data does show: ${target.confirmed} confirmed (${R(target.confirmed_cash_inr)} cash-type committed, which is not cash received) from ${target.brands_touched} brands touched.\n\nTo answer this, record spend on the Campaigns page; ROI will then be computed automatically.`);
    if (!known.length) return done(`**ROI / CAC cannot be calculated from the current data.** ${DATA_GAPS.campaign_spend}\n\nNo campaign has spend recorded in SponsorOS yet. Add spend on the Campaigns page and I can compute cost per confirmed partnership and confirmed cash per rupee.`);
    out.push(`**Cost metrics where spend is recorded** (as of ${asOf}):`);
    for (const c of known) out.push(`- ${c.name} (${c.id}): spend ${R(c.spend_inr)}, ${c.confirmed} confirmed, cost per confirmed ${typeof c.cost_per_confirmed_inr === "number" ? R(c.cost_per_confirmed_inr) : "n/a"}`);
    out.push(`\nLimits: ROI uses confirmed cash-type value, not receipts, and attribution is observational. ${camps.length - known.length} campaign(s) have no spend recorded.`);
    return done(out.join("\n"));
  }
  if (/(attendee|footfall|visitor|weather|stock price|competitor|satisfaction|nps|gst|tax)/.test(q)) {
    const a = await call("check_data_availability", { topic: q });
    return done(`**The sponsorship data cannot answer that.**\n\n${a.relevant_gaps.map((g: Any) => `- ${g.detail}`).join("\n")}\n\nI can answer questions about brands, outreach, opportunities, confirmed commitments, payment schedules, receipts, tasks and the forecast model.`);
  }

  // ---------- 3. what-if scenarios ----------
  if (/(what if|what happens|scenario|simulate|sensitivity|if (the )?(collection|win|deal|we))/.test(q)) {
    const o = parseScenario(q);
    if (!Object.keys(o).filter((k) => k !== "level").length) return done("Tell me which lever to change, e.g. *“what if the collection rate falls by 10 percentage points?”*, *“win rates 20% lower”*, *“deal size +15%”*, *“one fewer closer”* or *“referral volume -30%”*.");
    const r = await call("run_scenario", o);
    return done(`**[SIMULATION] Next-edition forecast with ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ")}: ${R(r.collected_inr)} collected before the festival**, vs ${R(r.plan_default_collected_inr)} in the approved ${r.level} plan (Δ ${R(r.delta_vs_plan_inr)}, ${P(r.delta_vs_plan_inr / r.plan_default_collected_inr)}).\n\nEvidence (model output):\n- Expected signed deals ${r.signed_deals_expected}; committed ${R(r.committed_inr)}; cash-type ${R(r.cash_type_inr)} (in-kind ${R(r.in_kind_inr)} excluded from cash)\n- Blended collection rate ${P(r.collection_rate)}; proposals ${r.proposals} of capacity ${r.capacity_proposals}${r.capacity_binding ? " (capacity is binding)" : ""}\n\nLimits: forward-looking expected values from model/assumptions.json — not actuals and not a guarantee.`);
  }

  const snap = ctx.snap;
  // ---------- 4. cash ----------
  const aboutCommitment = /(confirm|commit|signed|pledg)/.test(q) && !/(collect|receiv|receipt|paid|payment|invoice|outstanding|overdue|bank|in the bank)/.test(q);
  if (!aboutCommitment && /(cash|collect|receiv|receipt|paid|payment|invoice|outstanding|overdue|bank)/.test(q) && !/(campaign|channel)/.test(q)) {
    const c = await call("get_cash_position");
    const t = c.totals;
    const hist = /(2025|historical|histor|last year|actually|before the (2025 )?festival|did we)/.test(q);
    if (t.verified_received_inr === 0 && !snap.cash.historical_receipts_available) {
      out.push(`**Verified cash received: ${R(0)}. Historical cash collected is UNKNOWN** — ${DATA_GAPS.historical_receipts}`);
      if (hist) out.push(`\nWhat *is* known is the commitment: ${snap.deals.confirmed_cash_count} confirmed cash-type partnerships worth ${R(t.confirmed_cash_type_inr)} (plus ${R(t.confirmed_in_kind_inr)} in-kind, which is never cash). That is not evidence of payment.`);
    } else out.push(`**Verified cash received: ${R(t.verified_received_inr)}** of ${R(t.confirmed_cash_type_inr)} confirmed cash-type commitments (${P(t.verified_received_inr / (t.confirmed_cash_type_inr || 1))}).`);
    out.push(`\nEvidence (as of ${asOf}):\n- Confirmed cash-type ${R(t.confirmed_cash_type_inr)} · in-kind ${R(t.confirmed_in_kind_inr)} (excluded)\n- Scheduled ${R(t.scheduled_inr)} · invoiced ${R(t.invoiced_inr)} · due by now ${R(t.due_by_as_of_inr)} · overdue ${R(t.overdue_inr)}\n- Outstanding ${R(t.outstanding_inr)} · with no payment schedule ${R(t.unscheduled_confirmed_inr)}\n- Unverified receipts ${R(t.unverified_received_inr)} and test receipts ${R(t.test_receipts_excluded_inr)} are excluded from cash`);
    out.push(`- Pre-festival forecast ${R(c.forecast.total_pre_festival_inr)} = received ${R(c.forecast.received_inr)} + expected from confirmed ${R(c.forecast.expected_from_confirmed_inr)} + expected from pipeline ${R(c.forecast.expected_from_pipeline_inr)} [CALCULATED w/ ASSUMPTION: collection probability ${c.forecast.collection_probability}]`);
    if (t.cash_goal_inr) out.push(`- Cash goal ${R(t.cash_goal_inr)} → gap to goal on verified cash ${R(t.cash_goal_inr - t.verified_received_inr)}; on forecast ${R(t.cash_goal_inr - c.forecast.total_pre_festival_inr)}`);
    const risky = (c.lines as Any[]).filter((l) => l.status === "overdue" || l.status === "no_schedule").sort((a, b) => b.outstanding_inr - a.outstanding_inr).slice(0, 5);
    if (risky.length) out.push(`\nLargest exposures: ${risky.map((l) => `${l.brand} (${l.opportunity_id}) ${R(l.outstanding_inr)} ${l.status.replace("_", " ")}`).join("; ")}.\n\nRecommendation: generate payment schedules and send invoices for unscheduled confirmed deals first (Cash page → Generate schedule), then chase overdue milestones.`);
    return done(out.join("\n"));
  }

  if (aboutCommitment && !focus) {
    const o = await call("get_overview");
    return done(`**${o.deals.confirmed_cash_count + o.deals.confirmed_in_kind_count} confirmed partnerships as of ${asOf}: ${R(o.deals.confirmed_cash_inr)} cash-type commitments + ${R(o.deals.confirmed_in_kind_inr)} in-kind** (in-kind is never cash).

Evidence:
- ${o.deals.confirmed_cash_count} cash-type deals, average ${R(o.deals.avg_confirmed_cash_inr)}, median ${R(o.deals.median_confirmed_cash_inr)}
- Win rate on closed deals ${P(o.win_rate_closed.value)} (${o.win_rate_closed.numerator}/${o.win_rate_closed.denominator})
- Verified cash received so far ${R(o.cash.verified_received_inr)}

Limits: a confirmed commitment is not cash collected. ${o.cash.any_non_test_receipts_recorded ? "" : DATA_GAPS.historical_receipts}`);
  }
  // ---------- 5. readiness / intervention / next action ----------
  if (/(at risk|risk|intervention|intervene|priorit|today|next (best )?action|focus|urgent|attention|largest negotiat|should we do)/.test(q)) {
    const track = /negotiat|close|closing|pipeline/.test(q) ? "closing" : /cash|collect|payment/.test(q) ? "collection" : undefined;
    const r = await call("get_readiness_queue", { limit: 8, track, opportunity_id: focus && /^O/.test(focus) ? focus : undefined });
    const items = (r.items as Any[]).filter((x) => x.action !== "Collected — no action");
    if (!items.length) return done("No open or unpaid confirmed deals need action as of now.");
    out.push(`**Top ${Math.min(items.length, 8)} interventions by urgency** (as of ${asOf}; rule-based readiness score, not a payment probability):`);
    for (const x of items.slice(0, 8)) out.push(`- **${x.action}** — ${x.brand_name} (${x.opportunity_id}, ${x.stage}, ${R(x.value_inr)}), score ${x.score}/100, owner ${x.owner_name ?? "unassigned"}. Why: ${x.why}`);
    out.push(`\nSay *“create a task for the top one”* (or name a brand) and I will draft it for your confirmation.`);
    return done(out.join("\n"));
  }

  // ---------- 6. stale ----------
  if (/(stale|stuck|aging|ageing|old deals|idle|stalled|no movement)/.test(q)) {
    const r = await call("list_opportunities", { stale_only: true, sort_by: "days_in_stage", limit: 10 });
    out.push(`**${r.total_matching} open opportunities have been in their current stage longer than ${r.stale_threshold_days} days**, worth ${R(r.total_proposed_inr)} face value (as of ${asOf}).`);
    for (const o of r.opportunities) out.push(`- ${o.brand} (${o.opportunity_id}): ${o.stage}, ${o.days_in_stage} days, ${R(o.proposed_inr)}, ${o.channel_group} via ${o.campaign}, owner ${o.owner}${o.brand_met ? "" : ", no meeting held with brand"}`);
    const cold = (r.opportunities as Any[]).filter((o) => o.channel_group === "cold").length;
    out.push(`\nDiagnosis: ${cold} of the ${r.opportunities.length} listed are cold-originated. Historically, closed warm-channel deals were won far more often than cold ones (see campaign comparison). Recommendation: one final “close or disqualify” touch, then archive, so closers spend time on warm deals and collections.`);
    return done(out.join("\n"));
  }

  // ---------- 7. campaigns ----------
  if (/(campaign|channel|source|best|worst|perform|which.*(convert|conversion))/.test(q) && !/initiative|budget/.test(q)) {
    const sort = /meeting/.test(q) ? "meeting_rate" : /win/.test(q) ? "win_rate" : /(convert|conversion)/.test(q) ? "confirmed_per_brand" : "confirmed_cash_inr";
    const r = await call("compare_campaigns", { sort_by: sort });
    if (focus && /^SC/.test(focus)) {
      const c = (r.campaigns as Any[]).find((x) => x.id === focus);
      if (c) return done(`**${c.name} (${c.id})** as of ${asOf}: ${c.attempts} attempts to ${c.brands_touched} brands → ${c.brands_met} met (${P(c.meeting_rate.value)}) → ${c.opportunities} opportunities → ${c.confirmed} confirmed (${R(c.confirmed_cash_inr)} cash-type, ${R(c.confirmed_in_kind_inr)} in-kind). Win rate on closed deals ${P(c.win_rate_closed.value)} (${c.win_rate_closed.numerator}/${c.win_rate_closed.denominator}); opt-outs ${c.opt_outs}; open pipeline ${R(c.open_pipeline_inr)}; spend ${typeof c.spend_inr === "number" ? R(c.spend_inr) : "not recorded"}.\n\nLimits: ${r.caveat}`);
    }
    out.push(`**Campaigns ranked by ${sort.replace(/_/g, " ")}** (as of ${asOf}):`);
    for (const c of r.campaigns) out.push(`- ${c.name} (${c.id}, ${c.group}): ${c.confirmed} confirmed from ${c.brands_touched} brands = ${P(c.confirmed_per_brand.value)} per brand; meeting rate ${P(c.meeting_rate.value)}; ${R(c.confirmed_cash_inr)} cash-type confirmed; open ${R(c.open_pipeline_inr)}`);
    const warm = (r.campaigns as Any[]).filter((c) => c.group === "warm"), cold = (r.campaigns as Any[]).filter((c) => c.group === "cold");
    const s = (a: Any[], k: string) => a.reduce((x, c) => x + c[k], 0);
    out.push(`\nDiagnosis: warm/inbound campaigns produced ${s(warm, "confirmed")} confirmations from ${s(warm, "brands_touched")} brands; cold campaigns produced ${s(cold, "confirmed")} from ${s(cold, "brands_touched")}. Spend is not recorded, so this is yield per brand, not ROI.\n\nLimits: ${r.caveat}`);
    return done(out.join("\n"));
  }

  // ---------- 8. initiatives / budget / thresholds ----------
  if (/(initiative|budget|double down|invest|scale|stop|threshold|deserve|allocate|bet)/.test(q)) {
    const [plan, sig] = [await call("get_initiatives_plan", { level: "base" }), await call("get_threshold_signals")];
    out.push(`**Which initiative deserves more budget:** the plan ranks by expected incremental pre-festival cash × confidence ÷ effort. [SIMULATION] base-case increments (waterfall, sums to the plan without double counting):`);
    for (const w of plan.waterfall.slice(1)) out.push(`- ${w.label}: ${w.increment_inr >= 0 ? "+" : ""}${R(w.increment_inr)}`);
    out.push(`\nLive threshold signals (as of ${asOf}):`);
    for (const s of (sig.signals as Any[]).filter((x) => x.scope === "initiative" || x.signal === "stop")) out.push(`- ${s.subject} · ${s.label}: **${s.signal.toUpperCase()}** (${s.evidence}; scale at ${s.scale_at}, stop at ${s.stop_at}) → ${s.recommended_response}`);
    out.push(`\nRecommendation: fund I1 Cash Collection Desk first. It costs ₹15,000, and in 2025 none of the ₹20,00,000 of confirmed cash-type value had a payment schedule. Next, put closer time into warm sources (I2–I5) where the live signals say SCALE, and keep cold channels to a capped test.`);
    return done(out.join("\n"));
  }

  // ---------- 9. targets ----------
  if (/(target|goal|on track|behind|ahead|miss)/.test(q)) {
    const o = await call("get_overview");
    const t = o.targets;
    out.push(`**Targets vs actuals** (${t?.version}; as of ${asOf}):\n- Qualified brands ${t?.qualified.actual} vs goal ${t?.qualified.goal} (${P(t?.qualified.actual / t?.qualified.goal)})\n- Confirmed partnerships ${t?.confirmed.actual} vs goal ${t?.confirmed.goal} (${P(t?.confirmed.actual / t?.confirmed.goal)})\n- Verified cash ${R(t?.cash.received)} vs cash goal ${R(t?.cash.goal)} [goal basis: ${t?.basis}]`);
    out.push(`- Forecast pre-festival cash ${R(o.cash.forecast_pre_festival_inr)} (${o.cash.forecast_method})`);
    out.push(`\nWhere we miss: cash. ${R(o.cash.unscheduled_confirmed_inr)} of confirmed cash-type value has no payment schedule, and ${o.deals.open_stale_count} of ${o.deals.open_count} open deals are stale.`);
    return done(out.join("\n"));
  }

  // ---------- 10. tasks ----------
  if (/\btask/.test(q)) {
    const r = await call("get_tasks", { status: /done|complet/.test(q) ? "done" : "active", overdue_only: /overdue/.test(q) });
    if (!r.count) return done(`No ${/overdue/.test(q) ? "overdue " : ""}active tasks as of ${asOf}. Ask me “which sponsors need intervention?” to generate candidate actions.`);
    out.push(`**${r.count} task(s)** (as of ${asOf}):`);
    for (const t of r.tasks) out.push(`- #${t.id} ${t.title} — ${t.owner ?? "unassigned"}, due ${t.due?.slice(0, 10) ?? "n/a"}, ${t.status}${t.overdue ? " **(overdue)**" : ""}${t.recommendation_id ? `, from recommendation #${t.recommendation_id}` : ""}`);
    return done(out.join("\n"));
  }

  // ---------- 11. owner / industry ----------
  if (/(owner|who|team member|industry|category|sector)/.test(q) && !focus) {
    const by = /(industry|category|sector)/.test(q) ? "industry" : "owner";
    const r = await call("get_breakdown", { by });
    out.push(`**Performance by ${by}** (as of ${asOf}):`);
    for (const g of r.rows) out.push(`- ${g.key}: ${g.confirmed}/${g.opportunities} confirmed, ${R(g.confirmed_cash_inr)} cash-type, ${R(g.confirmed_in_kind_inr)} in-kind, open ${g.open} (${R(g.open_pipeline_inr)}), lost/withdrawn ${g.lost_withdrawn}`);
    return done(out.join("\n"));
  }

  // ---------- 12. entity detail ----------
  if (focus) {
    const e = await call("get_entity", { query: focus });
    if (e.type === "brand") {
      out.push(`**${e.brand.brand_name} (${e.brand.brand_id})** — ${e.brand.industry}, owner ${e.brand.owner ?? "unassigned"}; latest qualification **${e.qualification_history.at(-1)?.status ?? "none"}** (${e.qualification_history.at(-1)?.reason ?? ""}).`);
      out.push(`- ${e.interactions.length} interactions: ${[...new Set(e.interactions.map((i: Any) => i.type))].join(", ") || "none"}`);
      for (const o of e.opportunities) {
        out.push(`- ${o.opportunity_id}: **${o.stage}**, ${o.support_type}, proposed ${R(o.proposed_inr)}${o.confirmed_inr ? `, confirmed ${R(o.confirmed_inr)}` : ""}, ${o.days_in_stage} days in stage, via ${o.campaign}. Path: ${o.history.map((h: Any) => h.stage).join(" → ")}`);
        if (o.cash && typeof o.cash === "object") out.push(`  - Cash: received ${R(o.cash.received_verified_inr)}, outstanding ${R(o.cash.outstanding_inr)}, status ${o.cash.status}`);
      }
      const rq = await call("get_readiness_queue", { limit: 100 });
      const items = (rq.items as Any[]).filter((x) => e.opportunities.some((o: Any) => o.opportunity_id === x.opportunity_id));
      for (const x of items) out.push(`- Next best action for ${x.opportunity_id}: **${x.action}** (readiness ${x.score}/100; ${x.why})`);
      if (!e.opportunities.length) out.push("- No opportunity exists for this brand yet.");
      return done(out.join("\n"));
    }
    if (e.type === "campaign") { focus = e.campaign.id; history = [...history.slice(0, -1), { role: "user", content: `campaign ${focus}` }]; return localAnalyst(ctx, history); }
    if (e.type === "team_member") {
      out.push(`**${e.name} (${e.id})** owns ${e.opportunities.length} opportunities and ${e.tasks.length} tasks.`);
      for (const o of e.opportunities.slice(0, 10)) out.push(`- ${o.opportunity_id} ${o.brand}: ${o.stage}, ${R(o.proposed_inr)}`);
      return done(out.join("\n"));
    }
  }

  // ---------- 13. confirmed / funnel / overview ----------
  const o = await call("get_overview");
  if (/(confirm|commit|signed|partnership|deal)/.test(q)) {
    return done(`**${o.deals.confirmed_cash_count + o.deals.confirmed_in_kind_count} confirmed partnerships as of ${asOf}: ${R(o.deals.confirmed_cash_inr)} cash-type commitments + ${R(o.deals.confirmed_in_kind_inr)} in-kind** (in-kind is never cash).\n\nEvidence:\n- ${o.deals.confirmed_cash_count} cash-type deals, average ${R(o.deals.avg_confirmed_cash_inr)}, median ${R(o.deals.median_confirmed_cash_inr)}\n- Win rate on closed deals ${P(o.win_rate_closed.value)} (${o.win_rate_closed.numerator}/${o.win_rate_closed.denominator})\n- Verified cash received ${R(o.cash.verified_received_inr)}\n\nLimits: a confirmed commitment is not cash collected. ${o.cash.any_non_test_receipts_recorded ? "" : DATA_GAPS.historical_receipts}`);
  }
  if (/(funnel|conversion|pipeline|stage)/.test(q)) {
    const f = await call("get_funnel", {});
    out.push(`**Sponsorship funnel as of ${asOf}**`);
    out.push(`- Brands: touched ${f.brand_level.brands_touched} → replied ${f.brand_level.brands_replied} → positive ${f.brand_level.brands_positive} → met ${f.brand_level.brands_met} → qualified ${f.brand_level.qualified_brands} → with opportunity ${f.brand_level.brands_with_opportunity} → confirmed ${f.brand_level.confirmed_brands}`);
    for (const c of f.conversions) out.push(`- ${c.from} → ${c.to}: ${P(c.value)} (${c.numerator}/${c.denominator})`);
    out.push(`- Current stages: ${Object.entries(f.current_stage_counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    out.push(`\nBottleneck: confirmed commitments do not turn into verified cash (no payment schedules or receipts). In the pipeline, the open deals are concentrated in stale cold-channel opportunities.`);
    return done(out.join("\n"));
  }
  out.push(`Here is the current position (as of ${asOf}):\n- ${o.funnel.confirmed} confirmed partnerships: ${R(o.deals.confirmed_cash_inr)} cash-type + ${R(o.deals.confirmed_in_kind_inr)} in-kind\n- Verified cash received ${R(o.cash.verified_received_inr)}; outstanding ${R(o.cash.outstanding_inr)}; forecast ${R(o.cash.forecast_pre_festival_inr)}\n- Open pipeline ${o.deals.open_count} deals / ${R(o.deals.open_pipeline_inr)} (${o.deals.open_stale_count} stale)\n\nI can answer: cash collected and at risk, confirmed commitments, campaign comparison, stale deals, which sponsors need intervention, targets, initiative budgets and threshold signals, what-if scenarios, any brand/opportunity by name or ID, and I can draft tasks for your confirmation.`);
  return done(out.join("\n"));
}

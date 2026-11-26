/**
 * Sponsor Cash Readiness Engine — a transparent RULE-BASED operational score (0-100).
 * It is NOT a trained probability of payment. Every point is listed in `factors`.
 *
 * Two tracks:
 *  A) Confirmed cash deals (collection track): is the money on its way before the festival?
 *  B) Open deals (closing track): can this deal realistically become collectible cash before the festival?
 */
import { DAY, type Snapshot, type OppView, type CashLine } from "./snapshot";

export type Action =
  | "Close immediately" | "Request confirmation" | "Send proposal" | "Resolve decision-maker access"
  | "Issue invoice" | "Follow up on payment" | "Escalate overdue commitment" | "Deprioritise" | "Collected — no action";

export interface Factor { label: string; points: number }
export interface ReadinessItem {
  opportunity_id: string; opportunity_name: string; brand_name: string; owner_id: string | null; owner_name: string | null; stage: string; track: "collection" | "closing";
  value_inr: number; score: number; band: "high" | "medium" | "low"; action: Action; urgency: number; factors: Factor[]; why: string; missing: string[];
}

const STAGE_BASE: Record<string, number> = { prospecting: 10, contacted: 22, proposal_sent: 40, negotiating: 58 };
const ACTION_BY_STAGE: Record<string, Action> = { prospecting: "Resolve decision-maker access", contacted: "Send proposal", proposal_sent: "Request confirmation", negotiating: "Close immediately" };

export const READINESS_RULES = {
  closing: [
    "Stage base: prospecting 10, contacted 22, proposal_sent 40, negotiating 58",
    "Brand had a meeting held: +10; positive reply: +5; latest qualification 'qualified': +8",
    "Warm/inbound originating channel: +8 (2025: 24/25 closed warm deals won vs 0/8 cold)",
    "Days in current stage > stale threshold: -12; > 2x threshold: -22",
    "Days to festival shorter than median days-to-confirm: -15; fewer than 2 days: -30",
    "No primary contact: -5; brand opted out: forced Deprioritise",
    "Action = stage default; score < 25 => Deprioritise",
  ],
  collection: [
    "Start 100. No payment schedule: -45 (action Issue invoice)",
    "Overdue unpaid milestone: -35 (action Escalate overdue commitment)",
    "Next milestone due within 7 days: -10 (action Follow up on payment)",
    "Final milestone due within 3 days of festival start: -10",
    "Fully received (verified): score 100, action Collected — no action",
  ],
};

function band(s: number): ReadinessItem["band"] { return s >= 60 ? "high" : s >= 35 ? "medium" : "low"; }

function scoreClosing(o: OppView, snap: Snapshot, staleDays: number): ReadinessItem {
  const f: Factor[] = [{ label: `Stage ${o.stage}`, points: STAGE_BASE[o.stage] ?? 0 }];
  const missing: string[] = [];
  if (o.brand_met) f.push({ label: "Brand meeting held", points: 10 });
  if (o.brand_positive_reply) f.push({ label: "Positive reply recorded", points: 5 });
  if (o.brand_qualification === "qualified") f.push({ label: "Brand qualified", points: 8 });
  if (o.channel_group === "warm") f.push({ label: "Warm/inbound origin", points: 8 });
  if (o.days_in_stage > 2 * staleDays) f.push({ label: `Stuck ${Math.round(o.days_in_stage)}d in stage (>${2 * staleDays}d)`, points: -22 });
  else if (o.days_in_stage > staleDays) f.push({ label: `Stale ${Math.round(o.days_in_stage)}d in stage (>${staleDays}d)`, points: -12 });
  const cyc = snap.deals.median_days_to_confirm ?? 10;
  if (snap.days_to_festival < 2) f.push({ label: `Festival starts in ${snap.days_to_festival.toFixed(1)} days`, points: -30 });
  else if (snap.days_to_festival < cyc) f.push({ label: `Only ${snap.days_to_festival.toFixed(0)}d to festival vs median ${cyc.toFixed(0)}d to confirm`, points: -15 });
  if (!o.primary_contact_id) { f.push({ label: "No primary contact", points: -5 }); missing.push("primary contact"); }
  if (!o.proposed_value_inr) missing.push("proposed value");
  const score = Math.max(0, Math.min(100, f.reduce((a, b) => a + b.points, 0)));
  let action: Action = ACTION_BY_STAGE[o.stage] ?? "Resolve decision-maker access";
  if (o.brand_opted_out) { action = "Deprioritise"; f.push({ label: "Brand opted out (do not contact)", points: 0 }); }
  else if (score < 25) action = "Deprioritise";
  const urgency = action === "Deprioritise" ? 0 : (score / 100) * (o.proposed_value_inr / 1000) * (o.stage === "negotiating" ? 1.5 : 1);
  return {
    opportunity_id: o.opportunity_id, opportunity_name: o.opportunity_name, brand_name: o.brand_name, owner_id: o.owner_id, owner_name: o.owner_name, stage: o.stage, track: "closing",
    value_inr: o.proposed_value_inr, score, band: band(score), action, urgency, factors: f, missing,
    why: f.map((x) => `${x.label} (${x.points >= 0 ? "+" : ""}${x.points})`).join("; "),
  };
}

function scoreCollection(o: OppView, l: CashLine, snap: Snapshot): ReadinessItem {
  const f: Factor[] = [{ label: "Confirmed cash commitment", points: 100 }];
  let action: Action = "Follow up on payment";
  let urg = 0;
  if (l.status === "paid" || l.status === "over_collected") {
    action = "Collected — no action";
  } else {
    if (!l.milestones.length) { f.push({ label: "No payment schedule / invoice", points: -45 }); action = "Issue invoice"; urg += 3; }
    if (l.overdue_inr > 0) { f.push({ label: `Overdue ₹${l.overdue_inr.toLocaleString("en-IN")}`, points: -35 }); action = "Escalate overdue commitment"; urg += 4; }
    if (l.next_due_at != null && l.next_due_at - snap.as_of <= 7 * DAY && l.next_due_at > snap.as_of) { f.push({ label: "Next milestone due within 7 days", points: -10 }); if (action === "Follow up on payment") urg += 2; }
    const last = l.milestones.at(-1);
    if (last && last.due_at >= snap.festival_starts_at - 3 * DAY) f.push({ label: "Final milestone due within 3 days of festival", points: -10 });
    if (l.milestones.length && l.overdue_inr === 0 && action === "Follow up on payment") urg += 1;
  }
  const score = action === "Collected — no action" ? 100 : Math.max(0, Math.min(100, f.reduce((a, b) => a + b.points, 0)));
  return {
    opportunity_id: o.opportunity_id, opportunity_name: o.opportunity_name, brand_name: o.brand_name, owner_id: o.owner_id, owner_name: o.owner_name, stage: o.stage, track: "collection",
    value_inr: l.outstanding_inr, score, band: band(score), action, urgency: urg * (l.outstanding_inr / 1000), factors: f, missing: l.milestones.length ? [] : ["payment schedule", "invoice"],
    why: f.map((x) => `${x.label} (${x.points >= 0 ? "+" : ""}${x.points})`).join("; "),
  };
}

export function readinessQueue(snap: Snapshot, staleDays = 14): ReadinessItem[] {
  const lineById = new Map(snap.cash.lines.map((l) => [l.opportunity_id, l]));
  const items: ReadinessItem[] = [];
  for (const o of snap.opps) {
    if (o.stage === "partner_confirmed" && o.support_type === "cash") items.push(scoreCollection(o, lineById.get(o.opportunity_id)!, snap));
    else if (["prospecting", "contacted", "proposal_sent", "negotiating"].includes(o.stage)) items.push(scoreClosing(o, snap, staleDays));
  }
  return items.sort((a, b) => b.urgency - a.urgency || b.value_inr - a.value_inr);
}

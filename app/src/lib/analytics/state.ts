import type { Db } from "../db/client";

export const ms = (v: unknown): number => (v == null ? NaN : v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const s = (v: unknown): string | null => (v == null ? null : String(v));

export interface Brand { brand_id: string; brand_name: string; industry: string; owner_id: string | null; created_at: number; origin: string; notes: string | null }
export interface Contact { contact_id: string; brand_id: string; contact_name: string; job_title: string | null; email: string | null; created_at: number; origin: string }
export interface Campaign { id: string; name: string; channel: string; objective: string | null; audience: string | null; owner_id: string | null; planned_start_at: number; planned_end_at: number; created_at: number; status: string; budget_inr: number | null; initiative_id: string | null; origin: string }
export interface Spend { id: number; campaign_id: string; amount_inr: number; spent_on: number; note: string | null }
export interface Interaction { interaction_id: string; attempt_id: string; origin_interaction_id: string | null; brand_id: string; contact_id: string | null; campaign_id: string | null; owner_id: string | null; channel: string; event_type: string; outcome: string | null; summary: string | null; occurred_at: number; origin: string }
export interface QualVersion { history_id: string; brand_id: string; status: string; reason: string | null; campaign_id: string | null; effective_at: number; origin: string }
export interface Opportunity { opportunity_id: string; opportunity_name: string; brand_id: string; primary_contact_id: string | null; campaign_id: string | null; support_type: "cash" | "in_kind"; created_at: number; origin: string }
export interface OppVersion { history_id: string; opportunity_id: string; stage: string; proposed_value_inr: number; confirmed_value_inr: number; owner_id: string | null; effective_at: number; note: string | null; origin: string }
export interface Target { id: number; effective_at: number; target_version: string; qualified_brands_goal: number | null; confirmed_partnerships_goal: number | null; cash_collection_goal_inr: number | null; basis: string | null; origin: string }
export interface Milestone { id: number; opportunity_id: string; label: string; amount_inr: number; due_at: number; status: string; invoice_number: string | null; invoiced_at: number; basis: string }
export interface Receipt { id: number; opportunity_id: string; milestone_id: number | null; amount_inr: number; received_at: number; reference: string; verified: boolean; is_test: boolean; note: string | null }
export interface Task { id: number; title: string; description: string | null; owner_id: string | null; due_at: number; status: string; priority: string; opportunity_id: string | null; brand_id: string | null; campaign_id: string | null; initiative_id: string | null; recommendation_id: number | null; created_by: string; outcome: string | null; created_at: number; completed_at: number }
export interface Initiative { id: string; rank: number; name: string; owner_id: string | null; budget_inr: number; status: string; definition: Record<string, unknown> }
export interface Threshold { id: number; scope: string; scope_id: string; metric_key: string; label: string; direction: "higher_better" | "lower_better"; scale_at: number; stop_at: number; min_sample: number; unit: string }
export interface Recommendation { id: number; created_at: number; source: string; issue: string; evidence: unknown; diagnosis: string | null; action: string; expected_impact: string | null; status: string; decided_at: number; decision_note: string | null; task_id: number | null; outcome: string | null }

export interface State {
  event: { event_name: string; history_start: number; history_end: number; event_starts_at: number; event_ends_at: number; currency: string };
  team: Record<string, string>;
  brands: Brand[]; contacts: Contact[]; campaigns: Campaign[]; spend: Spend[]; interactions: Interaction[];
  qual: QualVersion[]; opps: Opportunity[]; oppHist: OppVersion[]; activations: { activation_id: string; opportunity_id: string; brand_id: string; attendee_campaign_name: string | null; linked_at: number }[];
  targets: Target[]; milestones: Milestone[]; receipts: Receipt[]; tasks: Task[]; initiatives: Initiative[]; thresholds: Threshold[]; recommendations: Recommendation[];
  settings: Record<string, unknown>;
  source: { file_name: string; sha256: string; imported_at: number; dedupe_log: Record<string, string[]>; row_counts: Record<string, number> } | null;
}

const PREFETCH = ["SELECT * FROM event WHERE id = 1", "SELECT id, name FROM team_members", "SELECT * FROM source_imports ORDER BY id DESC LIMIT 1", "SELECT key, value::text AS value FROM settings", "SELECT * FROM brands", "SELECT * FROM contacts", "SELECT * FROM campaigns ORDER BY sponsor_campaign_id", "SELECT * FROM campaign_spend", "SELECT * FROM interactions", "SELECT * FROM qualification_history", "SELECT * FROM opportunities", "SELECT * FROM opportunity_history", "SELECT * FROM activations", "SELECT * FROM targets", "SELECT * FROM payment_milestones", "SELECT * FROM receipts", "SELECT * FROM tasks ORDER BY id", "SELECT * FROM initiatives ORDER BY rank", "SELECT * FROM kpi_thresholds ORDER BY id", "SELECT * FROM recommendations ORDER BY id DESC"];

export async function loadState(db: Db): Promise<State> {
  // fire every read concurrently (pool) — memoised so each SQL string runs once
  const pending = new Map<string, Promise<Record<string, unknown>[]>>();
  const q = (sql: string) => { if (!pending.has(sql)) pending.set(sql, db.query<Record<string, unknown>>(sql)); return pending.get(sql)!; };
  // One round trip: every read is wrapped as a json_agg sub-select of a single statement
  // (concurrent queries hang through the Supabase transaction pooler; sequential ones cost 20 RTTs).
  const combo = (await db.query<Record<string, unknown>>(`SELECT ${PREFETCH.map((sql, i) => `(SELECT coalesce(json_agg(x), '[]'::json) FROM (${sql}) x) AS k${i}`).join(", ")}`))[0];
  PREFETCH.forEach((sql, i) => {
    const v = combo[`k${i}`];
    pending.set(sql, Promise.resolve((typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>[]));
  });
  const [ev] = await q(`SELECT * FROM event WHERE id = 1`);
  const team = Object.fromEntries((await q(`SELECT id, name FROM team_members`)).map((r) => [String(r.id), String(r.name)]));
  const [src] = await q(`SELECT * FROM source_imports ORDER BY id DESC LIMIT 1`);
  const settings = Object.fromEntries((await q(`SELECT key, value::text AS value FROM settings`)).map((r) => [String(r.key), JSON.parse(String(r.value))]));
  const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return {
    event: { event_name: String(ev.event_name), history_start: ms(ev.history_start), history_end: ms(ev.history_end), event_starts_at: ms(ev.event_starts_at), event_ends_at: ms(ev.event_ends_at), currency: String(ev.currency) },
    team,
    brands: (await q(`SELECT * FROM brands`)).map((r) => ({ brand_id: String(r.brand_id), brand_name: String(r.brand_name), industry: String(r.industry), owner_id: s(r.owner_id), created_at: ms(r.created_at), origin: String(r.origin), notes: s(r.notes) })),
    contacts: (await q(`SELECT * FROM contacts`)).map((r) => ({ contact_id: String(r.contact_id), brand_id: String(r.brand_id), contact_name: String(r.contact_name), job_title: s(r.job_title), email: s(r.email), created_at: ms(r.created_at), origin: String(r.origin) })),
    campaigns: (await q(`SELECT * FROM campaigns ORDER BY sponsor_campaign_id`)).map((r) => ({ id: String(r.sponsor_campaign_id), name: String(r.campaign_name), channel: String(r.channel), objective: s(r.objective), audience: s(r.audience), owner_id: s(r.owner_id), planned_start_at: ms(r.planned_start_at), planned_end_at: ms(r.planned_end_at), created_at: ms(r.created_at), status: String(r.status), budget_inr: r.budget_inr == null ? null : n(r.budget_inr), initiative_id: s(r.initiative_id), origin: String(r.origin) })),
    spend: (await q(`SELECT * FROM campaign_spend`)).map((r) => ({ id: n(r.id), campaign_id: String(r.campaign_id), amount_inr: n(r.amount_inr), spent_on: ms(r.spent_on), note: s(r.note) })),
    interactions: (await q(`SELECT * FROM interactions`)).map((r) => ({ interaction_id: String(r.interaction_id), attempt_id: String(r.attempt_id), origin_interaction_id: s(r.origin_interaction_id), brand_id: String(r.brand_id), contact_id: s(r.contact_id), campaign_id: s(r.campaign_id), owner_id: s(r.owner_id), channel: String(r.channel), event_type: String(r.event_type), outcome: s(r.outcome), summary: s(r.summary), occurred_at: ms(r.occurred_at), origin: String(r.origin) })),
    qual: (await q(`SELECT * FROM qualification_history`)).map((r) => ({ history_id: String(r.history_id), brand_id: String(r.brand_id), status: String(r.status), reason: s(r.reason), campaign_id: s(r.campaign_id), effective_at: ms(r.effective_at), origin: String(r.origin) })),
    opps: (await q(`SELECT * FROM opportunities`)).map((r) => ({ opportunity_id: String(r.opportunity_id), opportunity_name: String(r.opportunity_name), brand_id: String(r.brand_id), primary_contact_id: s(r.primary_contact_id), campaign_id: s(r.campaign_id), support_type: r.support_type === "in_kind" ? "in_kind" : "cash", created_at: ms(r.created_at), origin: String(r.origin) })),
    oppHist: (await q(`SELECT * FROM opportunity_history`)).map((r) => ({ history_id: String(r.history_id), opportunity_id: String(r.opportunity_id), stage: String(r.stage), proposed_value_inr: n(r.proposed_value_inr), confirmed_value_inr: n(r.confirmed_value_inr), owner_id: s(r.owner_id), effective_at: ms(r.effective_at), note: s(r.note), origin: String(r.origin) })),
    activations: (await q(`SELECT * FROM activations`)).map((r) => ({ activation_id: String(r.activation_id), opportunity_id: String(r.opportunity_id), brand_id: String(r.brand_id), attendee_campaign_name: s(r.attendee_campaign_name), linked_at: ms(r.linked_at) })),
    targets: (await q(`SELECT * FROM targets`)).map((r) => ({ id: n(r.id), effective_at: ms(r.effective_at), target_version: String(r.target_version), qualified_brands_goal: r.qualified_brands_goal == null ? null : n(r.qualified_brands_goal), confirmed_partnerships_goal: r.confirmed_partnerships_goal == null ? null : n(r.confirmed_partnerships_goal), cash_collection_goal_inr: r.cash_collection_goal_inr == null ? null : n(r.cash_collection_goal_inr), basis: s(r.basis), origin: String(r.origin) })),
    milestones: (await q(`SELECT * FROM payment_milestones`)).map((r) => ({ id: n(r.id), opportunity_id: String(r.opportunity_id), label: String(r.label), amount_inr: n(r.amount_inr), due_at: ms(r.due_at), status: String(r.status), invoice_number: s(r.invoice_number), invoiced_at: ms(r.invoiced_at), basis: String(r.basis) })),
    receipts: (await q(`SELECT * FROM receipts`)).map((r) => ({ id: n(r.id), opportunity_id: String(r.opportunity_id), milestone_id: r.milestone_id == null ? null : n(r.milestone_id), amount_inr: n(r.amount_inr), received_at: ms(r.received_at), reference: String(r.reference), verified: Boolean(r.verified), is_test: Boolean(r.is_test), note: s(r.note) })),
    tasks: (await q(`SELECT * FROM tasks ORDER BY id`)).map((r) => ({ id: n(r.id), title: String(r.title), description: s(r.description), owner_id: s(r.owner_id), due_at: ms(r.due_at), status: String(r.status), priority: String(r.priority), opportunity_id: s(r.opportunity_id), brand_id: s(r.brand_id), campaign_id: s(r.campaign_id), initiative_id: s(r.initiative_id), recommendation_id: r.recommendation_id == null ? null : n(r.recommendation_id), created_by: String(r.created_by), outcome: s(r.outcome), created_at: ms(r.created_at), completed_at: ms(r.completed_at) })),
    initiatives: (await q(`SELECT * FROM initiatives ORDER BY rank`)).map((r) => ({ id: String(r.id), rank: n(r.rank), name: String(r.name), owner_id: s(r.owner_id), budget_inr: n(r.budget_inr), status: String(r.status), definition: json(r.definition) as Record<string, unknown> })),
    thresholds: (await q(`SELECT * FROM kpi_thresholds ORDER BY id`)).map((r) => ({ id: n(r.id), scope: String(r.scope), scope_id: String(r.scope_id), metric_key: String(r.metric_key), label: String(r.label), direction: r.direction === "lower_better" ? "lower_better" : "higher_better", scale_at: n(r.scale_at), stop_at: n(r.stop_at), min_sample: n(r.min_sample), unit: String(r.unit) })),
    recommendations: (await q(`SELECT * FROM recommendations ORDER BY id DESC`)).map((r) => ({ id: n(r.id), created_at: ms(r.created_at), source: String(r.source), issue: String(r.issue), evidence: json(r.evidence), diagnosis: s(r.diagnosis), action: String(r.action), expected_impact: s(r.expected_impact), status: String(r.status), decided_at: ms(r.decided_at), decision_note: s(r.decision_note), task_id: r.task_id == null ? null : n(r.task_id), outcome: s(r.outcome) })),
    settings,
    source: src ? { file_name: String(src.file_name), sha256: String(src.sha256), imported_at: ms(src.imported_at), dedupe_log: json(src.dedupe_log) as Record<string, string[]>, row_counts: json(src.row_counts) as Record<string, number> } : null,
  };
}

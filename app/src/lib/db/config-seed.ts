import type { Db } from "./client";
import assumptions from "../../../data/model_assumptions.json";

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  // Operating clock: analytics are computed "as of" this instant; app edits are stamped at it.
  as_of: "2025-04-11T23:59:59+05:30",
  stale_days: 14,
  // [ASSUMPTION] collection policy used when generating payment schedules (Cash Collection Desk, I1)
  collection_policy: { advance_pct: 0.5, advance_due_days_after_signing: 2, balance_due_days_before_festival: 7 },
  // [ASSUMPTION] probability that an UNPAID confirmed cash commitment is received before the festival,
  // used only in the forward-looking cash forecast (never in actuals). Base-case blended value from model.
  forecast_collection_probability: 0.87,
};

const THRESHOLDS: Array<[string, string, string, string, "higher_better" | "lower_better", number, number, number, string]> = [
  // scope, scope_id, metric_key, label, direction, scale_at, stop_at, min_sample, unit
  ["initiative", "I1", "collection.on_time_rate", "Due cash received on time", "higher_better", 0.8, 0.6, 1, "ratio"],
  ["initiative", "I1", "collection.invoice_coverage", "Confirmed cash deals with a payment schedule", "higher_better", 0.9, 0.5, 1, "ratio"],
  ["initiative", "I2", "deals.avg_confirmed_cash_inr", "Average confirmed cash deal", "higher_better", 125000, 90000, 5, "inr"],
  ["initiative", "I3", "pipeline.qualified_without_opportunity", "Qualified brands with no opportunity", "lower_better", 3, 12, 0, "count"],
  ["initiative", "I4", "campaign.SC02.win_rate", "Warm intros: closed-won rate", "higher_better", 0.5, 0.25, 3, "ratio"],
  ["initiative", "I4", "campaign.SC02.meeting_rate", "Warm intros: brands met / brands touched", "higher_better", 0.7, 0.4, 5, "ratio"],
  ["initiative", "I5", "campaign.SC05.meeting_rate", "Creator referrals: brands met / brands touched", "higher_better", 0.7, 0.4, 5, "ratio"],
  ["initiative", "I5", "campaign.SC05.win_rate", "Creator referrals: closed-won rate", "higher_better", 0.5, 0.25, 3, "ratio"],
  ["campaign_rule", "*", "confirmed_per_brand", "Confirmed partnerships per brand touched", "higher_better", 0.2, 0.02, 20, "ratio"],
  ["campaign_rule", "*", "opt_out_rate", "Opt-outs per brand touched", "lower_better", 0.01, 0.05, 20, "ratio"],
];

const INITIATIVE_OWNERS: Record<string, string> = { I1: "T02", I2: "T01", I3: "T02", I4: "T01", I5: "T05" };
const CAMPAIGN_INITIATIVE: Record<string, string> = { SC02: "I4", SC04: "I3", SC05: "I5" };

export async function seedOperationalConfig(db: Db) {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
    await db.query(`INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);

  await db.query(
    `INSERT INTO targets(effective_at, target_version, qualified_brands_goal, confirmed_partnerships_goal, cash_collection_goal_inr, basis, origin)
     VALUES ('2025-03-15T09:00:01+05:30', 'Revised plan + cash goal', 55, 28, 2500000,
     '[SOURCE] qualified 55 / confirmed 28 from Sponsor revised plan. [ASSUMPTION] cash goal = 28 partnerships x 100,000 avg 2025 cash deal x 0.893 cash share ~= 2,500,000', 'app')
     ON CONFLICT DO NOTHING`,
  );

  const team = new Set((await db.query<{ id: string }>(`SELECT id FROM team_members`)).map((r) => r.id));
  for (const i of assumptions.initiatives) {
    const owner = team.has(INITIATIVE_OWNERS[i.id]) ? INITIATIVE_OWNERS[i.id] : null;
    await db.query(
      `INSERT INTO initiatives(id, rank, name, owner_id, budget_inr, definition) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [i.id, i.rank, i.name, owner, i.budget_inr, JSON.stringify(i)],
    );
  }
  for (const [cid, iid] of Object.entries(CAMPAIGN_INITIATIVE))
    await db.query(`UPDATE campaigns SET initiative_id = $2 WHERE sponsor_campaign_id = $1 AND initiative_id IS NULL`, [cid, iid]);
  for (const t of THRESHOLDS)
    await db.query(
      `INSERT INTO kpi_thresholds(scope, scope_id, metric_key, label, direction, scale_at, stop_at, min_sample, unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      t,
    );
}

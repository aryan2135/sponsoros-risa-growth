import type { Db } from "./db/client";
import { loadState, ms } from "./analytics/state";
import { computeSnapshot, latestBy } from "./analytics/snapshot";
import { readinessQueue, READINESS_RULES } from "./analytics/readiness";
import { evaluateThresholds } from "./analytics/thresholds";
import { getSetting } from "./services";

/** Single payload for the UI. Everything is recomputed from the database on each request. */
export async function buildDashboard(db: Db, asOfOverride?: string | null) {
  const S = await loadState(db);
  const asOf = asOfOverride ? ms(asOfOverride) : ms(S.settings.as_of);
  if (Number.isNaN(asOf)) throw new Error("Invalid as-of date");
  const staleDays = Number(S.settings.stale_days ?? 14);
  const snap = computeSnapshot(S, asOf);
  const { stage_probability: _omit, ...snapshot } = snap; // eslint-disable-line @typescript-eslint/no-unused-vars
  const q = latestBy(S.qual, (r) => r.brand_id, asOf);
  const ix = S.interactions.filter((i) => i.occurred_at <= asOf);
  const brands = S.brands.filter((b) => b.created_at <= asOf).map((b) => {
    const bi = ix.filter((i) => i.brand_id === b.brand_id);
    const bo = snap.opps.filter((o) => o.brand_id === b.brand_id);
    return {
      ...b, owner_name: S.team[b.owner_id ?? ""] ?? null, qualification: q.get(b.brand_id)?.status ?? null, qualification_reason: q.get(b.brand_id)?.reason ?? null,
      contacts: S.contacts.filter((c) => c.brand_id === b.brand_id).length, interactions: bi.length, last_touch_at: bi.length ? Math.max(...bi.map((i) => i.occurred_at)) : null,
      met: bi.some((i) => i.event_type === "meeting_held"), opted_out: bi.some((i) => i.event_type === "opt_out"),
      opportunities: bo.map((o) => ({ id: o.opportunity_id, stage: o.stage, value: o.confirmed_value_inr || o.proposed_value_inr, support_type: o.support_type })),
    };
  });
  const readiness = readinessQueue(snap, staleDays);
  return {
    as_of: asOf, as_of_setting: S.settings.as_of, settings: S.settings, team: S.team, event: S.event, source: S.source,
    snapshot, brands, readiness, readiness_rules: READINESS_RULES, thresholds: evaluateThresholds(S, snap), threshold_defs: S.thresholds,
    tasks: S.tasks, initiatives: S.initiatives, recommendations: S.recommendations.slice(0, 50),
    contacts: S.contacts, interactions_recent: ix.sort((a, b) => b.occurred_at - a.occurred_at).slice(0, 40), spend: S.spend,
    forecast_collection_probability: await getSetting<number>(db, "forecast_collection_probability"),
  };
}
export type Dashboard = Awaited<ReturnType<typeof buildDashboard>>;

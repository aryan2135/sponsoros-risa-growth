/** Evaluates the editable scale/change/stop thresholds stored in kpi_thresholds against live metrics. */
import type { Snapshot } from "./snapshot";
import type { State, Threshold } from "./state";

export type Signal = "scale" | "change" | "stop" | "insufficient_data";
export interface ThresholdResult {
  threshold_id: number; scope: string; scope_id: string; subject: string; metric_key: string; label: string; unit: string;
  value: number | null; sample: number; scale_at: number; stop_at: number; direction: string; signal: Signal; evidence: string; recommended_response: string;
}

function metric(snap: Snapshot, key: string): { value: number | null; sample: number; evidence: string } {
  const camp = key.match(/^campaign\.(\w+)\.(\w+)$/);
  if (camp) {
    const c = snap.campaigns.find((x) => x.id === camp[1]);
    if (!c) return { value: null, sample: 0, evidence: `campaign ${camp[1]} not found` };
    const r = (c as unknown as Record<string, { value: number | null; num: number; den: number }>)[camp[2]];
    if (!r) return { value: null, sample: 0, evidence: `metric ${camp[2]} unknown` };
    return { value: r.value, sample: r.den, evidence: `${c.name}: ${r.num}/${r.den}` };
  }
  switch (key) {
    case "collection.on_time_rate": {
      const due = snap.cash.lines.flatMap((l) => l.milestones.filter((m) => m.due_at <= snap.as_of));
      const amt = due.reduce((a, m) => a + m.amount_inr, 0);
      const paid = due.reduce((a, m) => a + Math.min(m.paid_inr, m.amount_inr), 0);
      return { value: amt ? paid / amt : null, sample: due.length, evidence: `₹${paid.toLocaleString("en-IN")} received of ₹${amt.toLocaleString("en-IN")} due across ${due.length} milestone(s)` };
    }
    case "collection.invoice_coverage": {
      const n = snap.cash.lines.length, k = snap.cash.lines.filter((l) => l.milestones.length).length;
      return { value: n ? k / n : null, sample: n, evidence: `${k}/${n} confirmed cash deals have a payment schedule` };
    }
    case "deals.avg_confirmed_cash_inr":
      return { value: snap.deals.avg_confirmed_cash_inr, sample: snap.deals.confirmed_cash_count, evidence: `${snap.deals.confirmed_cash_count} confirmed cash deals, total ₹${snap.deals.confirmed_cash_inr.toLocaleString("en-IN")}` };
    case "pipeline.qualified_opportunity_coverage": {
      const q = snap.funnel.qualified_brands, miss = snap.qualified_without_opportunity.length;
      return { value: q ? (q - miss) / q : null, sample: q, evidence: `${q - miss}/${q} qualified brands have an opportunity (${miss} never pitched)` };
    }
    case "pipeline.qualified_without_opportunity":
      return { value: snap.qualified_without_opportunity.length, sample: snap.funnel.qualified_brands, evidence: `${snap.qualified_without_opportunity.length} of ${snap.funnel.qualified_brands} qualified brands have no opportunity` };
  }
  return { value: null, sample: 0, evidence: `unknown metric ${key}` };
}

function judge(t: Threshold, value: number | null, sample: number): Signal {
  if (value == null || sample < t.min_sample) return "insufficient_data";
  if (t.direction === "higher_better") return value >= t.scale_at ? "scale" : value < t.stop_at ? "stop" : "change";
  return value <= t.scale_at ? "scale" : value >= t.stop_at ? "stop" : "change";
}

export function evaluateThresholds(S: State, snap: Snapshot): ThresholdResult[] {
  const out: ThresholdResult[] = [];
  const initName = new Map(S.initiatives.map((i) => [i.id, i]));
  for (const t of S.thresholds) {
    const targets = t.scope === "campaign_rule" ? snap.campaigns.map((c) => ({ key: `campaign.${c.id}.${t.metric_key}`, subject: c.name })) : [{ key: t.metric_key, subject: `${t.scope_id} ${initName.get(t.scope_id)?.name ?? ""}`.trim() }];
    for (const tg of targets) {
      const m = metric(snap, tg.key);
      const signal = judge(t, m.value, m.sample);
      const def = initName.get(t.scope_id)?.definition as Record<string, string> | undefined;
      const response = signal === "insufficient_data" ? `Need sample >= ${t.min_sample} before judging; keep collecting data.`
        : t.scope === "campaign_rule"
          ? signal === "stop" ? "Stop or pause new outreach on this campaign; move closer time to warm sources." : signal === "scale" ? "Scale: add volume / owner time." : "Change: tighten targeting and require a meeting before proposals."
          : signal === "scale" ? def?.scale ?? "Scale" : signal === "stop" ? def?.stop ?? "Stop" : def?.change ?? "Change";
      out.push({ threshold_id: t.id, scope: t.scope, scope_id: t.scope_id, subject: tg.subject, metric_key: tg.key, label: t.label, unit: t.unit, value: m.value, sample: m.sample, scale_at: t.scale_at, stop_at: t.stop_at, direction: t.direction, signal, evidence: m.evidence, recommended_response: response });
    }
  }
  return out;
}

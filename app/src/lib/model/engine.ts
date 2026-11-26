/**
 * TypeScript port of analysis/financial_model.py (expected-value path is exact; Monte Carlo is
 * statistically equivalent, not bit-identical). Assumptions: data/model_assumptions.json (copy of model/assumptions.json).
 * Scenarios never touch actual records: they are pure functions of assumptions + overrides.
 */
import A from "../../../data/model_assumptions.json";

export type Level = "base" | "stretch";
export const STEPS: [string, string][] = [
  ["BAU", "Repeat 2025 playbook (BAU)"],
  ["PLAN", "Cut cold volume to ABM test + plan capacity"],
  ["I2", "I2 Renewal, Tiering & Upsell"],
  ["I3", "I3 Qualified-Lead Recovery + Inbound Page"],
  ["I4", "I4 Alumni & Sponsor Referral Engine"],
  ["I5", "I5 Creator & Community Referrals"],
  ["I1", "I1 Cash Collection Desk"],
];

export interface SourceParams { id: string; name: string; initiative: string; prospects: number; conv: number; prop: number; win: number; deal: number; cash_share: number | null }
export interface Params {
  cash_share: number; withdrawal: number; closers: number; proposals_per_closer: number; collection_desk: boolean; bau_collection: number;
  phase_mix: number[]; phase_prob: number[]; attach: number; addon: number; sources: SourceParams[];
}

type LV = { bau: number; base: number; stretch: number };
const pick = (o: LV, l: "bau" | Level) => o[l];

export function resolve(level: Level, enabled: Set<string>): Params {
  const g = A.global;
  const planOn = enabled.has("PLAN");
  const lv = (on: boolean) => (on ? level : "bau") as "bau" | Level;
  return {
    cash_share: pick(g.cash_share_of_committed_value as LV, lv(planOn)),
    withdrawal: pick(g.post_signing_withdrawal_rate as LV, lv(planOn)),
    closers: pick(g.closers as LV, lv(planOn)),
    proposals_per_closer: pick(g.proposals_per_closer as LV, lv(planOn)),
    collection_desk: enabled.has("I1"),
    bau_collection: g.collection.bau_flat_rate,
    phase_mix: [...(g.collection.signing_phase_mix as Record<string, number[]>)[level]],
    phase_prob: [...(g.collection.collect_prob_by_phase as Record<string, number[]>)[level]],
    attach: pick(g.upsell.attach_rate as LV, lv(enabled.has("I2"))),
    addon: pick(g.upsell.addon_cash_inr as LV, lv(enabled.has("I2"))),
    sources: A.sources.map((s) => {
      const on = (s.initiative === "DEPRIORITISE" && planOn) || enabled.has(s.initiative);
      const L = lv(on);
      const dedup = (s as { dedup?: boolean }).dedup ? pick(g.prospect_dedup_factor as LV, lv(planOn)) : 1;
      const csh = (s as { cash_share?: LV }).cash_share;
      return { id: s.id, name: s.name, initiative: s.initiative, prospects: pick(s.prospects, L) * dedup, conv: pick(s.p_conversation, L), prop: pick(s.p_proposal, L), win: pick(s.p_win, L), deal: pick(s.avg_deal_inr, L), cash_share: csh ? pick(csh, L) : null };
    }),
  };
}
export const allEnabled = () => new Set(STEPS.map((s) => s[0]).filter((k) => k !== "BAU"));

const cs = (p: Params, s: { cash_share: number | null }) => s.cash_share ?? p.cash_share;
export const collectionRate = (p: Params) => (p.collection_desk ? p.phase_mix.reduce((a, m, i) => a + m * p.phase_prob[i], 0) : p.bau_collection);

export function expected(p: Params) {
  const cap = p.closers * p.proposals_per_closer;
  const rows = p.sources.map((s) => {
    const conversations = s.prospects * s.conv;
    return { ...s, conversations, proposal_demand: conversations * s.prop, ev_per_proposal: s.win * s.deal, proposals: 0, signed: 0, committed_inr: 0, cash_type_inr: 0, in_kind_inr: 0, net_cash_inr: 0, upsell_net_cash_inr: 0, collected_inr: 0 };
  });
  let left = cap;
  for (const r of [...rows].sort((a, b) => b.ev_per_proposal - a.ev_per_proposal)) { r.proposals = Math.min(r.proposal_demand, left); left -= r.proposals; }
  const cr = collectionRate(p);
  for (const r of rows) {
    r.signed = r.proposals * r.win;
    r.committed_inr = r.signed * r.deal;
    r.cash_type_inr = r.committed_inr * cs(p, r);
    r.in_kind_inr = r.committed_inr - r.cash_type_inr;
    r.net_cash_inr = r.cash_type_inr * (1 - p.withdrawal);
    r.upsell_net_cash_inr = r.signed * cs(p, r) * p.attach * p.addon * (1 - p.withdrawal);
    r.collected_inr = (r.net_cash_inr + r.upsell_net_cash_inr) * cr;
  }
  const S = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const totals = {
    capacity_proposals: cap, proposal_demand: S("proposal_demand"), proposals: S("proposals"), capacity_binding: S("proposal_demand") > cap + 1e-9,
    prospects: S("prospects"), conversations: S("conversations"), signed: S("signed"), committed_inr: S("committed_inr"), cash_type_inr: S("cash_type_inr"),
    in_kind_inr: S("in_kind_inr"), withdrawal_loss_inr: S("cash_type_inr") - S("net_cash_inr"), net_cash_inr: S("net_cash_inr"),
    upsell_net_cash_inr: S("upsell_net_cash_inr"), collection_rate: cr, collected_inr: S("collected_inr"), uncollected_by_festival_inr: 0,
  };
  totals.uncollected_by_festival_inr = totals.net_cash_inr + totals.upsell_net_cash_inr - totals.collected_inr;
  return { rows, totals };
}

export function waterfall(level: Level, mutate?: (p: Params) => void) {
  const enabled = new Set<string>();
  let prev = 0;
  return STEPS.map(([k, label]) => {
    if (k !== "BAU") enabled.add(k);
    const p = resolve(level, enabled);
    mutate?.(p);
    const t = expected(p).totals;
    const row = { step: k, label, collected_inr: t.collected_inr, signed: t.signed, increment_inr: t.collected_inr - prev };
    prev = t.collected_inr;
    return row;
  });
}

/** Simulator overrides: applied on top of a resolved level. All optional. */
export interface Overrides {
  prospects_multiplier?: number; warm_prospects_multiplier?: number; conversation_multiplier?: number; proposal_multiplier?: number;
  win_multiplier?: number; deal_multiplier?: number; cash_share?: number; withdrawal?: number; closers?: number; proposals_per_closer?: number;
  collection_prob_delta?: number; collection_desk?: boolean; attach?: number; cold_prospects?: number; budget_inr?: number;
}
export function applyOverrides(p: Params, o: Overrides) {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  for (const s of p.sources) {
    if (o.prospects_multiplier != null) s.prospects *= o.prospects_multiplier;
    if (o.warm_prospects_multiplier != null && ["alumni_referral", "creator_referral", "inbound"].includes(s.id)) s.prospects *= o.warm_prospects_multiplier;
    if (o.cold_prospects != null && s.id === "cold_outbound") s.prospects = o.cold_prospects;
    if (o.conversation_multiplier != null) s.conv = clamp(s.conv * o.conversation_multiplier);
    if (o.proposal_multiplier != null) s.prop = clamp(s.prop * o.proposal_multiplier);
    if (o.win_multiplier != null) s.win = clamp(s.win * o.win_multiplier);
    if (o.deal_multiplier != null) s.deal *= o.deal_multiplier;
  }
  if (o.cash_share != null) { p.cash_share = clamp(o.cash_share); for (const s of p.sources) s.cash_share = null; } // lever overrides per-source shares too
  if (o.withdrawal != null) p.withdrawal = clamp(o.withdrawal);
  if (o.closers != null) p.closers = Math.max(0, o.closers);
  if (o.proposals_per_closer != null) p.proposals_per_closer = Math.max(0, o.proposals_per_closer);
  if (o.collection_desk != null) p.collection_desk = o.collection_desk;
  if (o.collection_prob_delta != null) { p.phase_prob = p.phase_prob.map((x) => clamp(x + o.collection_prob_delta!)); p.bau_collection = clamp(p.bau_collection + o.collection_prob_delta); }
  if (o.attach != null) p.attach = clamp(o.attach);
  return p;
}

export function runScenario(level: Level, o: Overrides = {}) {
  const p = applyOverrides(resolve(level, allEnabled()), o);
  const res = expected(p);
  const baseline = expected(resolve(level, allEnabled())).totals.collected_inr;
  const bau = expected(resolve(level, new Set())).totals.collected_inr;
  const budget = o.budget_inr ?? A.initiatives.reduce((a, i) => a + i.budget_inr, 0);
  return { level, overrides: o, params: p, ...res, costs: planCosts(level, res), plan_default_collected_inr: baseline, bau_collected_inr: bau, delta_vs_plan_inr: res.totals.collected_inr - baseline, budget_inr: budget, cash_per_budget_rupee: budget ? (res.totals.collected_inr - bau) / budget : null, waterfall: waterfall(level, (q) => applyOverrides(q, o)), label: "[SIMULATION] forward-looking expected values; not actuals" };
}

// ---------------- Monte Carlo (seeded) ----------------
const DEALS_2025 = [50000, 50000, 65000, 65000, 80000, 80000, 90000, 90000, 90000, 95000, 95000, 105000, 105000, 110000, 110000, 120000, 125000, 125000, 150000, 200000];
const MEAN_2025 = DEALS_2025.reduce((a, b) => a + b, 0) / DEALS_2025.length;
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gamma(r: () => number, k: number): number {
  if (k < 1) return gamma(r, k + 1) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { const u1 = r(), u2 = r(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
const beta = (r: () => number, m: number, k = 20) => (m <= 0 ? 0 : m >= 1 ? 1 : (() => { const x = gamma(r, m * k), y = gamma(r, (1 - m) * k); return x / (x + y); })());
const binom = (r: () => number, n: number, p: number) => { let c = 0; for (let i = 0; i < n; i++) if (r() < p) c++; return c; };

export function monteCarlo(p: Params, n = 3000, seed = 7) {
  const r = rng(seed);
  const cap = p.closers * p.proposals_per_closer;
  const srcs = [...p.sources].sort((a, b) => b.win * b.deal - a.win * a.deal);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let left = Math.floor(cap), total = 0;
    for (const s of srcs) {
      if (s.prospects <= 0) continue;
      const conv = binom(r, Math.round(s.prospects), beta(r, s.conv));
      const props = Math.min(binom(r, conv, beta(r, s.prop)), left); left -= props;
      const k = binom(r, props, beta(r, s.win));
      for (let j = 0; j < k; j++) {
        const val = s.deal * (DEALS_2025[Math.floor(r() * DEALS_2025.length)] / MEAN_2025);
        if (r() >= cs(p, s) || r() < p.withdrawal) continue;
        const due = val + (r() < p.attach ? p.addon : 0);
        let got: boolean;
        if (p.collection_desk) { const u = r(); const ph = u < p.phase_mix[0] ? 0 : u < p.phase_mix[0] + p.phase_mix[1] ? 1 : 2; got = r() < p.phase_prob[ph]; } else got = r() < p.bau_collection;
        if (got) total += due;
      }
    }
    out.push(total);
  }
  out.sort((a, b) => a - b);
  const q = (x: number) => out[Math.min(out.length - 1, Math.floor(x * out.length))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), mean: out.reduce((a, b) => a + b, 0) / n, n };
}

/** Costs deducted for the net view (gross collected cash is the assignment objective). */
export function planCosts(level: Level, res: ReturnType<typeof expected>) {
  const c = A.global.costs;
  const budget = A.initiatives.reduce((a, i) => a + i.budget_inr, 0);
  const stipend = (c.closer_stipend_inr as LV)[level];
  const fee = c.finder_fee_rate.value * res.rows.filter((r) => c.finder_fee_rate.applies_to.includes(r.id)).reduce((a, r) => a + r.collected_inr, 0);
  return { budget_inr: budget, closer_stipend_inr: stipend, finder_fees_inr: fee, total_cost_inr: budget + stipend + fee, net_cash_after_costs_inr: res.totals.collected_inr - budget - stipend - fee };
}
export function downside() {
  const d = A.downside;
  const res = expected(applyOverrides(resolve(d.level as Level, allEnabled()), d.overrides as Overrides));
  return { overrides: d.overrides, ...res, costs: planCosts(d.level as Level, res) };
}

export const ASSUMPTIONS = A;

"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from "recharts";
import { api, useDash } from "@/lib/client";
import { Card, PageHeader, Stat, inr, pct, LabelTag, Tag } from "@/components/ui";

type Res = { totals: Record<string, number | boolean>; rows: Record<string, number | string>[]; waterfall: { step: string; label: string; collected_inr: number; increment_inr: number; signed: number }[]; plan_default_collected_inr: number; bau_collected_inr: number; delta_vs_plan_inr: number; budget_inr: number; cash_per_budget_rupee: number | null; monte_carlo: { p10: number; p50: number; p90: number; mean: number } | null };
type O = Record<string, number | boolean | undefined>;

const LEVERS: { k: string; label: string; min: number; max: number; step: number; def: number; fmt: (v: number) => string; help: string }[] = [
  { k: "budget_inr", label: "Sponsorship budget", min: 50000, max: 600000, step: 5000, def: 215000, fmt: (v) => inr(v), help: "Total initiative budget (for cash-per-rupee)" },
  { k: "prospects_multiplier", label: "All prospect volume", min: 0.5, max: 1.5, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "Scales prospects for every source" },
  { k: "warm_prospects_multiplier", label: "Warm referral volume", min: 0.5, max: 1.8, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "Alumni, creator & inbound prospects" },
  { k: "cold_prospects", label: "Cold ABM prospects", min: 0, max: 200, step: 10, def: 40, fmt: (v) => `${v} brands`, help: "2025 cold: 148 brands, 0 confirmed" },
  { k: "conversation_multiplier", label: "Contact → conversation rate", min: 0.5, max: 1.3, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "" },
  { k: "proposal_multiplier", label: "Conversation → proposal", min: 0.5, max: 1.3, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "" },
  { k: "win_multiplier", label: "Win rate", min: 0.4, max: 1.6, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "Proposal → signed" },
  { k: "deal_multiplier", label: "Average deal value", min: 0.6, max: 1.6, step: 0.05, def: 1, fmt: (v) => `×${v.toFixed(2)}`, help: "" },
  { k: "cash_share", label: "Cash share of committed value", min: 0.5, max: 1, step: 0.01, def: 0.89, fmt: (v) => pct(v), help: "2025: 0.893 [CALCULATED]" },
  { k: "collection_prob_delta", label: "Collection probability shift", min: -0.3, max: 0.1, step: 0.01, def: 0, fmt: (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} pp`, help: "Applied to each signing phase" },
  { k: "withdrawal", label: "Post-signing withdrawal", min: 0, max: 0.2, step: 0.01, def: 0.04, fmt: (v) => pct(v), help: "2025: 1/25 = 4%" },
  { k: "closers", label: "Closers (team capacity)", min: 2, max: 9, step: 1, def: 5, fmt: (v) => `${v}`, help: "× 20 proposals each" },
];

export default function Simulator() {
  const { toast } = useDash();
  const [level, setLevel] = useState<"base" | "stretch">("base");
  const [o, setO] = useState<O>({});
  const [desk, setDesk] = useState(true);
  const [res, setRes] = useState<Res | null>(null);
  const [mc, setMc] = useState(false);
  const [saved, setSaved] = useState<{ id: number; name: string; level: string; overrides: O; result: { collected_inr: number; signed: number } }[]>([]);
  const [name, setName] = useState("");
  const overrides = useMemo(() => ({ ...o, collection_desk: desk ? undefined : false }), [o, desk]);
  useEffect(() => { const t = setTimeout(() => api<Res>("POST", "scenarios/run", { level, overrides, monte_carlo: mc }).then(setRes).catch((e) => toast(e.message, "err")), 120); return () => clearTimeout(t); }, [level, overrides, mc, toast]);
  useEffect(() => { api<{ saved: typeof saved }>("GET", "scenarios").then((r) => setSaved(r.saved)); }, []);
  const t = res?.totals;
  const wf = res?.waterfall.map((w, i) => ({ ...w, base: i === 0 ? 0 : Math.min(w.collected_inr, w.collected_inr - w.increment_inr), bar: Math.abs(w.increment_inr) })) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Scenario simulator" subtitle={<>Forward-looking model for the next edition, calibrated on 2025 data (assumptions in model/assumptions.json). <b>Scenarios never modify actual records.</b></>}
        actions={<><div className="flex rounded-lg border border-line bg-white p-0.5">{(["base", "stretch"] as const).map((l) => <button key={l} className={`rounded-md px-3 py-1 text-[12px] font-medium capitalize ${level === l ? "bg-ink text-white" : "text-ink-2"}`} onClick={() => { setLevel(l); setO({}); }}>{l}</button>)}</div><button className="btn" onClick={() => { setO({}); setDesk(true); }}>Reset levers</button></>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Forecast cash collected pre-festival" value={inr(Number(t?.collected_inr ?? 0), true)} tag={<LabelTag kind="SIMULATION" />} sub={res && <>Plan default {inr(res.plan_default_collected_inr, true)} · Δ {inr(res.delta_vs_plan_inr, true)}</>} tone={res && res.delta_vs_plan_inr < 0 ? "warn" : "good"} />
        <Stat label="Committed value" value={inr(Number(t?.committed_inr ?? 0), true)} sub={<>Cash-type {inr(Number(t?.cash_type_inr ?? 0), true)} · in-kind {inr(Number(t?.in_kind_inr ?? 0), true)}</>} />
        <Stat label="Expected signed deals" value={Number(t?.signed ?? 0).toFixed(1)} sub="Expected value — not whole deals" />
        <Stat label="Blended collection rate" value={pct(Number(t?.collection_rate ?? 0), 1)} sub={`Uncollected by festival ${inr(Number(t?.uncollected_by_festival_inr ?? 0), true)}`} />
        <Stat label="Incremental cash per ₹ budget" value={res?.cash_per_budget_rupee != null ? `₹${res.cash_per_budget_rupee.toFixed(0)}` : "—"} sub={res && `vs BAU ${inr(res.bau_collected_inr, true)} · budget ${inr(res.budget_inr, true)}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Levers" subtitle="Applied on top of the selected plan level">
          <div className="space-y-3">
            {LEVERS.map((l) => { const v = Number(o[l.k] ?? (l.k === "closers" ? (level === "stretch" ? 6 : 5) : l.k === "withdrawal" ? (level === "stretch" ? 0.03 : 0.04) : l.k === "cash_share" ? (level === "stretch" ? 0.9 : 0.89) : l.k === "budget_inr" ? 215000 : l.k === "cold_prospects" ? 40 : l.def)); return (
              <div key={l.k}>
                <div className="flex justify-between text-[12px]"><label htmlFor={l.k} className="font-medium text-ink-2">{l.label}</label><span className="num font-semibold">{l.fmt(v)}</span></div>
                <input id={l.k} type="range" className="w-full accent-teal-600" min={l.min} max={l.max} step={l.step} value={v} onChange={(e) => setO({ ...o, [l.k]: Number(e.target.value) })} />
                {l.help && <p className="text-[11px] text-muted">{l.help}</p>}
              </div>); })}
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={desk} onChange={(e) => setDesk(e.target.checked)} /> Cash Collection Desk (I1) active — off = 70% flat collection [ASSUMPTION]</label>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={mc} onChange={(e) => setMc(e.target.checked)} /> Run Monte Carlo (2,000 runs) for an uncertainty band</label>
          </div>
        </Card>
        <div className="space-y-5 xl:col-span-3">
          <Card title="Bridge: BAU → plan, by initiative" subtitle="Ordered waterfall; increments sum exactly to the forecast (no double counting)">
            <div className="h-64"><ResponsiveContainer><BarChart data={wf} margin={{ top: 16, right: 8, left: 8 }}>
              <CartesianGrid vertical={false} stroke="#eef2f6" /><XAxis dataKey="step" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => inr(v, true)} width={64} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number, n: string, p: { payload?: { label: string; increment_inr: number; collected_inr: number } }) => (n === "bar" ? [`${inr(p.payload!.increment_inr)} → cumulative ${inr(p.payload!.collected_inr)}`, p.payload!.label] : [null, null])} cursor={{ fill: "#f1f5f9" }} />
              <RBar dataKey="base" stackId="w" fill="transparent" /><RBar dataKey="bar" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={48}>{wf.map((w, i) => <Cell key={i} fill={i === 0 ? "#94a3b8" : w.increment_inr < 0 ? "#e11d48" : "#0d9488"} />)}<LabelList dataKey="increment_inr" position="top" formatter={(v: number) => inr(v, true)} style={{ fontSize: 10, fill: "#334155" }} /></RBar>
            </BarChart></ResponsiveContainer></div>
            <p className="text-[11px] text-muted">BAU = repeat 2025 playbook at risk-adjusted rates. Grey = BAU base, teal = increase, red = decrease.</p>
          </Card>
          {res?.monte_carlo && <Card title="Uncertainty band (Monte Carlo)" subtitle="Beta-distributed rates, binomial deal counts, 2025 deal-size shape, per-deal withdrawal & collection"><div className="grid grid-cols-4 gap-3 text-center">{(["p10", "p50", "p90", "mean"] as const).map((k) => <div key={k}><p className="label">{k.toUpperCase()}</p><p className="num text-[18px] font-semibold">{inr(res.monte_carlo![k], true)}</p></div>)}</div></Card>}
          <Card title="By source" bodyClass="p-0">
            <table className="tbl"><thead><tr><th>Source</th><th>Initiative</th><th>Prospects</th><th>Proposals</th><th>Signed (EV)</th><th>Collected</th></tr></thead>
              <tbody>{res?.rows.map((r) => <tr key={String(r.id)}><td>{String(r.name)}</td><td><Tag>{String(r.initiative)}</Tag></td><td className="num">{Number(r.prospects).toFixed(0)}</td><td className="num">{Number(r.proposals).toFixed(1)}{Number(r.proposals) < Number(r.proposal_demand) - 0.01 && <span className="text-[11px] text-amber-600"> (capacity-cut from {Number(r.proposal_demand).toFixed(1)})</span>}</td><td className="num">{Number(r.signed).toFixed(2)}</td><td className="num">{inr(Number(r.collected_inr))}</td></tr>)}</tbody></table>
            {t?.capacity_binding && <p className="px-5 py-2 text-[12px] text-amber-700">Closer capacity is binding ({Number(t.capacity_proposals)} proposals). Lowest-yield sources are cut first.</p>}
          </Card>
          <Card title="Save & compare scenarios" bodyClass="p-4">
            <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name) return; await api("POST", "scenarios/run", { level, overrides, save: true, name, monte_carlo: mc }); toast("Scenario saved"); setName(""); setSaved((await api<{ saved: typeof saved }>("GET", "scenarios")).saved); }}>
              <input className="input flex-1" placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" /><button className="btn-primary">Save</button>
            </form>
            <table className="tbl"><thead><tr><th>Scenario</th><th>Level</th><th>Overrides</th><th>Collected</th></tr></thead>
              <tbody>{saved.map((s) => <tr key={s.id} className="cursor-pointer" onClick={() => { setLevel(s.level as "base"); setO(s.overrides); setDesk(s.overrides.collection_desk !== false); }}><td>{s.name}</td><td>{s.level}</td><td className="max-w-xs truncate font-mono text-[11px]">{JSON.stringify(s.overrides)}</td><td className="num">{inr(s.result.collected_inr, true)}</td></tr>)}</tbody></table>
          </Card>
        </div>
      </div>
    </div>
  );
}

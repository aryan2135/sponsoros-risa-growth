"use client";
import Link from "next/link";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from "recharts";
import { useDash } from "@/lib/client";
import { Card, Stat, PageHeader, Loading, inr, pct, SignalTag, StageTag, Tag, Bar, LabelTag } from "@/components/ui";

const axis = { fontSize: 11, fill: "#64748b" };

export default function Overview() {
  const { data } = useDash();
  if (!data) return <Loading />;
  const s = data.snapshot, c = s.cash, f = s.funnel;
  const goal = s.targets?.cash.goal ?? null;
  const waterfall = [
    { name: "Open pipeline (cash, face value)", v: c.open_pipeline_cash_inr },
    { name: "Confirmed cash-type", v: c.confirmed_cash_inr },
    { name: "Scheduled", v: c.scheduled_inr },
    { name: "Invoiced", v: c.invoiced_inr },
    { name: "Verified received", v: c.received_verified_inr },
  ];
  const funnel = [
    ["Brands touched", f.brands_touched], ["Replied", f.brands_replied], ["Met", f.brands_met], ["Qualified", f.qualified_brands], ["With opportunity", f.brands_with_opportunity], ["Confirmed", f.confirmed_brands],
  ].map(([name, v]) => ({ name, v: v as number }));
  const queue = data.readiness.filter((r) => r.action !== "Collected — no action" && r.action !== "Deprioritise").slice(0, 7);
  const campaignSignals = data.thresholds.filter((t) => t.scope === "campaign_rule" && t.metric_key.endsWith("confirmed_per_brand"));
  return (
    <div className="space-y-5">
      <PageHeader title="Revenue-to-cash overview" subtitle={<>Everything below is computed live from the database as of the operating clock. Commitments are not cash; in-kind is never cash; “received” counts verified receipts only.</>} />

      {!c.historical_receipts_available && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <span className="text-lg leading-none">⚠</span>
          <div><b>Cash collected in the 2025 source data is unknown.</b> The workbook contains no receipts, invoices or payment dates, and no campaign spend, so ROI/CAC cannot be computed. {inr(c.confirmed_cash_inr)} of confirmed cash-type commitments is a promise, not money in the bank. Record receipts on the <Link className="underline" href="/cash">Cash Control Tower</Link>.</div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="1 · Cash actually received" value={inr(c.received_verified_inr)} tone={c.received_verified_inr > 0 ? "good" : "bad"} tag={<LabelTag kind={c.historical_receipts_available ? "CALCULATED" : "UNKNOWN"} />}
          sub={goal ? <>{pct(c.received_verified_inr / goal)} of {inr(goal, true)} cash goal{c.test_receipts_inr > 0 && <> · {inr(c.test_receipts_inr)} test receipts excluded</>}</> : "No cash goal set"} />
        <Stat label="2 · Expected before festival" value={inr(c.forecast.total_pre_festival_inr, true)} tag={<LabelTag kind="CALCULATED" />}
          sub={<>{inr(c.forecast.received_inr, true)} received + {inr(c.forecast.expected_from_confirmed_inr, true)} confirmed × {c.forecast.collection_probability} + {inr(c.forecast.expected_from_pipeline_inr, true)} pipeline</>} />
        <Stat label="3 · Cash at risk" value={inr(c.at_risk_inr, true)} tone={c.at_risk_inr > 0 ? "bad" : "good"} sub={<>{c.at_risk_count} commitments: no schedule, overdue, or due ≤3d before festival</>} />
        <Stat label="Confirmed commitments" value={inr(c.confirmed_cash_inr, true)} sub={<>{s.deals.confirmed_cash_count} cash-type deals · +{inr(c.confirmed_in_kind_inr, true)} in-kind (not cash)</>} tag={<LabelTag kind="CALCULATED" />} />
        <Stat label="Open pipeline" value={inr(s.deals.open_pipeline_inr, true)} tone={s.deals.open_stale_count > s.deals.open_count / 2 ? "warn" : "default"} sub={<>{s.deals.open_count} open deals · {s.deals.open_stale_count} stale &gt;{String(data.settings.stale_days)}d</>} />
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Cash conversion waterfall" subtitle="Where sponsor value stops on its way to the bank (INR)">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={waterfall} margin={{ top: 18, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={0} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => inr(v, true)} width={64} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v: number) => [inr(v), "Value"]} />
                <RBar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {waterfall.map((w, i) => <Cell key={i} fill={i === 0 ? "#94a3b8" : "#0d9488"} />)}
                  <LabelList dataKey="v" position="top" formatter={(v: number) => inr(v, true)} style={{ fontSize: 11, fill: "#334155" }} />
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">Gap from confirmed to received: <b className="text-slate-800">{inr(c.confirmed_cash_inr - c.received_verified_inr)}</b>. {inr(c.unscheduled_confirmed_inr)} has no payment schedule yet.</p>
        </Card>
        <Card className="xl:col-span-2" title="4 · Prioritise today" subtitle="Readiness engine — rule-based, explainable" action={<Link href="/pipeline?view=queue" className="btn-ghost">Full queue →</Link>} bodyClass="p-0">
          <ul className="divide-y divide-slate-100">
            {queue.map((r) => (
              <li key={r.opportunity_id} className="px-5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-[13px] font-medium text-slate-900">{r.action}</p><p className="truncate text-[12px] text-slate-500">{r.brand_name} · {r.opportunity_id} · {r.owner_name ?? "unassigned"}</p></div>
                  <div className="text-right"><p className="num text-[13px] font-semibold">{inr(r.value_inr, true)}</p><Tag tone={r.band === "high" ? "green" : r.band === "medium" ? "amber" : "red"}>{r.score}/100</Tag></div>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] text-slate-400" title={r.why}>{r.why}</p>
              </li>
            ))}
            {!queue.length && <li className="px-5 py-6 text-[13px] text-slate-500">Nothing needs action.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="5 · Which campaigns deserve investment" subtitle="Confirmed partnerships per brand touched, with the stored scale/stop rule" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Campaign</th><th>Brands</th><th>Met</th><th>Confirmed</th><th className="w-40">Confirmed / brand</th><th>Cash-type confirmed</th><th>Open</th><th>Signal</th></tr></thead>
              <tbody>
                {[...s.campaigns].sort((a, b) => (b.confirmed_per_brand.value ?? 0) - (a.confirmed_per_brand.value ?? 0)).map((cp) => {
                  const sig = campaignSignals.find((t) => t.metric_key === `campaign.${cp.id}.confirmed_per_brand`);
                  return (
                    <tr key={cp.id}>
                      <td><p className="font-medium text-slate-900">{cp.name}</p><p className="text-[11px] text-slate-400">{cp.id} · {cp.channel} · {cp.channel_group}</p></td>
                      <td className="num">{cp.brands_touched}</td><td className="num">{cp.brands_met}</td><td className="num">{cp.confirmed}</td>
                      <td><div className="flex items-center gap-2"><Bar value={cp.confirmed_per_brand.value ?? 0} max={1} /><span className="num w-10 text-right text-[12px]">{pct(cp.confirmed_per_brand.value)}</span></div></td>
                      <td className="num">{inr(cp.confirmed_cash_inr, true)}</td><td className="num">{inr(cp.open_pipeline_inr, true)}</td>
                      <td>{sig ? <SignalTag signal={sig.signal} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-2.5 text-[11px] text-slate-500">Attribution is observational (originating campaign at opportunity creation). Spend is not in the source data, so this is yield per brand, not ROI.</p>
        </Card>
        <Card className="xl:col-span-2" title="Brand funnel" subtitle="Distinct brands at each step (as of clock)">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={axis} width={108} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v: number) => [v, "Brands"]} />
                <RBar dataKey="v" fill="#0d9488" radius={[0, 4, 4, 0]} maxBarSize={22}><LabelList dataKey="v" position="right" style={{ fontSize: 11, fill: "#334155" }} /></RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {s.targets && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-[12px]">
              <p className="font-semibold text-slate-700">Targets · {s.targets.version}</p>
              {[["Qualified brands", s.targets.qualified.actual, s.targets.qualified.goal], ["Confirmed partnerships", s.targets.confirmed.actual, s.targets.confirmed.goal], ["Verified cash (₹)", s.targets.cash.received, s.targets.cash.goal]].map(([l, a, g]) => (
                <div key={String(l)}><div className="flex justify-between"><span>{l}</span><span className="num font-medium">{typeof a === "number" && Number(g) > 1000 ? `${inr(a, true)} / ${inr(Number(g), true)}` : `${a} / ${g ?? "—"}`}</span></div><Bar value={Number(a)} max={Number(g) || 1} tone={Number(a) >= Number(g) ? "teal" : "amber"} /></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Initiative threshold signals" subtitle="Live metric vs approved scale / stop thresholds (editable on Campaigns & Playbook)" bodyClass="p-0">
          <table className="tbl"><thead><tr><th>Initiative</th><th>KPI</th><th>Value</th><th>Scale / Stop</th><th>Signal</th></tr></thead>
            <tbody>{data.thresholds.filter((t) => t.scope === "initiative").map((t) => (
              <tr key={t.metric_key + t.scope_id}><td className="font-medium">{t.subject}</td><td>{t.label}<p className="text-[11px] text-slate-400">{t.evidence}</p></td>
                <td className="num">{t.value == null ? "—" : t.unit === "inr" ? inr(t.value, true) : t.unit === "ratio" ? pct(t.value) : t.value}</td>
                <td className="num text-[12px]">{t.unit === "inr" ? `${inr(t.scale_at, true)} / ${inr(t.stop_at, true)}` : t.unit === "ratio" ? `${pct(t.scale_at)} / ${pct(t.stop_at)}` : `${t.scale_at} / ${t.stop_at}`}</td><td><SignalTag signal={t.signal} /></td></tr>))}</tbody>
          </table>
        </Card>
        <Card title="Pipeline by stage" subtitle="Latest full-state version per opportunity" bodyClass="p-0">
          <table className="tbl"><thead><tr><th>Stage</th><th>Deals</th><th>Face value</th><th>Conversion to next stage (ever reached)</th></tr></thead>
            <tbody>{s.stages.map((st) => { const conv = s.conversions.find((x) => x.from === st.stage); return (
              <tr key={st.stage}><td><StageTag stage={st.stage} /></td><td className="num">{st.count}</td><td className="num">{inr(st.proposed_inr)}</td><td className="num text-[12px]">{conv ? `${pct(conv.value)} (${conv.num}/${conv.den})` : "—"}</td></tr>); })}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

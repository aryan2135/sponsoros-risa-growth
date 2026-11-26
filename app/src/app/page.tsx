"use client";
import Link from "next/link";
import { useDash } from "@/lib/client";
import { Card, Stat, PageHeader, Loading, inr, pct, SignalTag, StageTag, Tag, Bar, LabelTag } from "@/components/ui";

/** Signature visual: value narrowing from pipeline to verified cash, drawn as a ribbon. */
function CashRiver({ stages }: { stages: { name: string; v: number; tone: string; note?: string }[] }) {
  const W = 760, H = 168, top = 34, band = 96, bw = 10;
  const max = Math.max(...stages.map((s) => s.v), 1);
  const n = stages.length;
  const x = (i: number) => 18 + (i * (W - 36 - bw)) / (n - 1);
  const h = (v: number) => (v <= 0 ? 2 : Math.max(4, (v / max) * band));
  const cy = top + band / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cash river: value at each stage from pipeline to verified cash">
      <defs>
        <linearGradient id="river" x1="0" x2="1">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.28" />
          <stop offset="35%" stopColor="#0d9488" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.10" />
        </linearGradient>
      </defs>
      {stages.slice(0, -1).map((s, i) => {
        const a = h(s.v) / 2, b = h(stages[i + 1].v) / 2, x0 = x(i) + bw, x1 = x(i + 1), mx = (x0 + x1) / 2;
        return <path key={i} d={`M${x0},${cy - a} C${mx},${cy - a} ${mx},${cy - b} ${x1},${cy - b} L${x1},${cy + b} C${mx},${cy + b} ${mx},${cy + a} ${x0},${cy + a} Z`} fill="url(#river)" />;
      })}
      {stages.map((s, i) => (
        <g key={s.name}>
          <rect x={x(i)} y={cy - h(s.v) / 2} width={bw} height={h(s.v)} rx={3} fill={s.tone} />
          <text x={x(i) + bw / 2} y={16} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[#7a7f8c] font-mono text-[10px] uppercase tracking-[0.08em]">{s.name}</text>
          <text x={x(i) + bw / 2} y={H - 14} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[#141a26] text-[19px]" style={{ fontFamily: "var(--font-display-serif), Georgia, serif" }}>{inr(s.v, true)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function Overview() {
  const { data } = useDash();
  if (!data) return <Loading />;
  const s = data.snapshot, c = s.cash, f = s.funnel;
  const goal = s.targets?.cash.goal ?? null;
  const stuck = c.confirmed_cash_inr - c.received_verified_inr;
  const funnel = [["Brands touched", f.brands_touched], ["Replied", f.brands_replied], ["Met", f.brands_met], ["Qualified", f.qualified_brands], ["With opportunity", f.brands_with_opportunity], ["Confirmed", f.confirmed_brands]] as [string, number][];
  const fmax = Math.max(...funnel.map((x) => x[1]), 1);
  const queue = data.readiness.filter((r) => r.action !== "Collected — no action" && r.action !== "Deprioritise").slice(0, 8);
  const campaignSignals = data.thresholds.filter((t) => t.scope === "campaign_rule" && t.metric_key.endsWith("confirmed_per_brand"));
  return (
    <div className="space-y-4">
      <PageHeader kicker="01 — Command overview" title="Revenue-to-cash overview" subtitle={<>Live from the database as of the operating clock. Commitments are not cash, in-kind is never cash, and “received” counts verified receipts only.</>} />

      {!c.historical_receipts_available && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-2 text-[12.5px] text-amber-900">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-200/70 text-[12px] font-bold">!</span>
          <p><b>Cash collected in the 2025 source data is unknown.</b> No receipts, invoices, payment dates or spend in the workbook, so {inr(c.confirmed_cash_inr)} of commitments is a promise, not money in the bank, and ROI/CAC can&apos;t be computed. <Link className="font-semibold underline decoration-amber-400 underline-offset-2" href="/cash">Record receipts →</Link></p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="1 · Cash actually received" value={inr(c.received_verified_inr)} tone={c.received_verified_inr > 0 ? "good" : "bad"} tag={<LabelTag kind={c.historical_receipts_available ? "CALCULATED" : "UNKNOWN"} />}
          sub={goal ? <>{pct(c.received_verified_inr / goal)} of {inr(goal, true)} goal{c.test_receipts_inr > 0 && <> · {inr(c.test_receipts_inr)} test excluded</>}</> : "No cash goal set"} />
        <Stat label="2 · Expected by T-0" value={inr(c.forecast.total_pre_festival_inr, true)} tag={<LabelTag kind="CALCULATED" />}
          sub={<>{inr(c.forecast.received_inr, true)} received + {inr(c.forecast.expected_from_confirmed_inr, true)} confirmed × {c.forecast.collection_probability} + {inr(c.forecast.expected_from_pipeline_inr, true)} pipeline</>} />
        <Stat label="3 · Cash at risk" value={inr(c.at_risk_inr, true)} tone={c.at_risk_inr > 0 ? "bad" : "good"} sub={<>{c.at_risk_count} commitments unscheduled, overdue or due ≤3d before T-0</>} />
        <Stat label="Confirmed commitments" value={inr(c.confirmed_cash_inr, true)} sub={<>{s.deals.confirmed_cash_count} cash deals · +{inr(c.confirmed_in_kind_inr, true)} in-kind (not cash)</>} tag={<LabelTag kind="CALCULATED" />} />
        <Stat label="Open pipeline" value={inr(s.deals.open_pipeline_inr, true)} tone={s.deals.open_stale_count > s.deals.open_count / 2 ? "warn" : "default"} sub={<>{s.deals.open_count} open · {s.deals.open_stale_count} stale &gt;{String(data.settings.stale_days)}d</>} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="flex flex-col xl:col-span-8 xl:h-[372px]" kicker="Cash river" title="Where sponsor value stops on its way to the bank" bodyClass="flex flex-1 flex-col px-4 pb-4"
          action={<Link href="/cash" className="btn-ghost">Control tower →</Link>}>
          <div className="flex flex-1 items-center"><CashRiver stages={[
            { name: "Open pipeline", v: c.open_pipeline_cash_inr, tone: "#94a3b8" },
            { name: "Confirmed", v: c.confirmed_cash_inr, tone: "#141a26" },
            { name: "Scheduled", v: c.scheduled_inr, tone: "#0f766e" },
            { name: "Invoiced", v: c.invoiced_inr, tone: "#0d9488" },
            { name: "Received", v: c.received_verified_inr, tone: "#2dd4bf" },
          ]} /></div>
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11.5px]">
            <div><p className="kicker">Stuck after commitment</p><p className="display num text-[20px] text-rose-700">{inr(stuck, true)}</p></div>
            <div><p className="kicker">No payment schedule</p><p className="display num text-[20px] text-ink">{inr(c.unscheduled_confirmed_inr, true)}</p></div>
            <div><p className="kicker">Overdue</p><p className="display num text-[20px] text-ink">{inr(c.overdue_inr, true)}</p></div>
          </div>
        </Card>
        <Card className="flex flex-col xl:col-span-4 xl:h-[372px]" kicker="Readiness engine" title="4 · Prioritise today" subtitle="Rule-based and explainable, not a payment probability" action={<Link href="/pipeline?view=queue" className="btn-ghost">Queue →</Link>} bodyClass="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ol className="space-y-0.5">
            {queue.map((r, i) => (
              <li key={r.opportunity_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-paper">
                <span className="w-4 font-mono text-[10px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-ink">{r.action} · {r.brand_name}</p>
                  <p className="truncate text-[11px] text-muted" title={r.why}><span className="id">{r.opportunity_id}</span> · {r.owner_name ?? "unassigned"} · {r.why}</p>
                </div>
                <div className="text-right">
                  <p className="num text-[12.5px] font-semibold text-ink">{inr(r.value_inr, true)}</p>
                  <p className={`font-mono text-[10px] ${r.band === "high" ? "text-emerald-700" : r.band === "medium" ? "text-amber-700" : "text-rose-700"}`}>{r.score}/100</p>
                </div>
              </li>
            ))}
            {!queue.length && <li className="px-2 py-4 text-[12.5px] text-muted">Nothing needs action.</li>}
          </ol>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8" kicker="Campaign yield" title="5 · Which campaigns deserve investment" subtitle="Confirmed partnerships per brand touched, judged by the stored scale/stop rule" bodyClass="pb-1">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Campaign</th><th className="text-right">Brands</th><th className="text-right">Met</th><th className="text-right">Won</th><th className="w-40">Won / brand</th><th className="text-right">Cash won</th><th className="text-right">Open</th><th>Signal</th></tr></thead>
              <tbody>
                {[...s.campaigns].sort((a, b) => (b.confirmed_per_brand.value ?? 0) - (a.confirmed_per_brand.value ?? 0)).map((cp) => {
                  const sig = campaignSignals.find((t) => t.metric_key === `campaign.${cp.id}.confirmed_per_brand`);
                  return (
                    <tr key={cp.id}>
                      <td className="whitespace-nowrap"><span className="font-medium text-ink">{cp.name}</span> <span className="id ml-1">{cp.id}</span> <span className={`ml-1 rounded px-1 font-mono text-[9.5px] ${cp.channel_group === "warm" ? "bg-brand-soft text-teal-800" : "bg-paper-2 text-muted"}`}>{cp.channel_group}</span></td>
                      <td className="num text-right">{cp.brands_touched}</td><td className="num text-right">{cp.brands_met}</td><td className="num text-right">{cp.confirmed}</td>
                      <td><div className="flex items-center gap-2"><Bar value={cp.confirmed_per_brand.value ?? 0} max={1} tone={cp.channel_group === "warm" ? "teal" : "red"} /><span className="num w-9 text-right text-[11.5px]">{pct(cp.confirmed_per_brand.value)}</span></div></td>
                      <td className="num text-right">{inr(cp.confirmed_cash_inr, true)}</td><td className="num text-right">{inr(cp.open_pipeline_inr, true)}</td>
                      <td>{sig ? <SignalTag signal={sig.signal} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-muted">Attribution is observational. Spend isn&apos;t in the source, so this is yield per brand, not ROI.</p>
        </Card>
        <Card className="xl:col-span-4" kicker="Brand funnel" title="Distinct brands at each step" bodyClass="px-4 pb-4">
          <div className="space-y-1.5">
            {funnel.map(([name, v], i) => (
              <div key={name} className="grid grid-cols-[104px_1fr_34px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink-2">{name}</span>
                <div className="h-[18px] rounded-[5px] bg-paper"><div className="h-full rounded-[5px]" style={{ width: `${(v / fmax) * 100}%`, background: i === funnel.length - 1 ? "#141a26" : `rgba(13,148,136,${0.35 + (i / funnel.length) * 0.65})` }} /></div>
                <span className="num text-right font-semibold text-ink">{v}</span>
              </div>
            ))}
          </div>
          {s.targets && (
            <div className="mt-3 space-y-2 border-t border-line pt-3 text-[11.5px]">
              <p className="kicker">Targets · {s.targets.version}</p>
              {([["Qualified brands", s.targets.qualified.actual, s.targets.qualified.goal, false], ["Confirmed partnerships", s.targets.confirmed.actual, s.targets.confirmed.goal, false], ["Verified cash", s.targets.cash.received, s.targets.cash.goal, true]] as [string, number, number | null, boolean][]).map(([l, a, g, money]) => (
                <div key={l}>
                  <div className="mb-0.5 flex justify-between"><span className="text-ink-2">{l}</span><span className="num font-medium text-ink">{money ? `${inr(a, true)} / ${inr(Number(g), true)}` : `${a} / ${g ?? "—"}`}</span></div>
                  <Bar value={Number(a)} max={Number(g) || 1} tone={Number(a) >= Number(g) ? "teal" : "amber"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7" kicker="Playbook" title="Initiative threshold signals" subtitle="Live metric vs approved scale / stop thresholds (editable in Campaigns & Playbook)" bodyClass="pb-1">
          <table className="tbl table-fixed"><colgroup><col className="w-[30%]" /><col /><col className="w-[64px]" /><col className="w-[92px]" /><col className="w-[118px]" /></colgroup>
            <thead><tr><th>Initiative</th><th>KPI</th><th className="text-right">Now</th><th className="text-right">Scale / Stop</th><th>Signal</th></tr></thead>
            <tbody>{data.thresholds.filter((t) => t.scope === "initiative").map((t) => (
              <tr key={t.metric_key + t.scope_id}>
                <td className="truncate" title={t.subject}><span className="mr-1.5 rounded bg-ink px-1 py-[1px] font-mono text-[9.5px] text-white">{t.scope_id}</span><span className="font-medium text-ink">{t.subject.replace(/^I\d\s/, "")}</span></td>
                <td className="truncate" title={`${t.label} — ${t.evidence}`}><span className="text-ink-2">{t.label}</span><span className="block truncate text-[10.5px] text-muted">{t.evidence}</span></td>
                <td className="num text-right">{t.value == null ? "—" : t.unit === "inr" ? inr(t.value, true) : t.unit === "ratio" ? pct(t.value) : t.value}</td>
                <td className="num whitespace-nowrap text-right text-[11.5px] text-muted">{t.unit === "inr" ? `${inr(t.scale_at, true)} / ${inr(t.stop_at, true)}` : t.unit === "ratio" ? `${pct(t.scale_at)} / ${pct(t.stop_at)}` : `${t.scale_at} / ${t.stop_at}`}</td>
                <td><SignalTag signal={t.signal} /></td></tr>))}</tbody>
          </table>
        </Card>
        <Card className="xl:col-span-5" kicker="Pipeline" title="Deals by stage" subtitle="Latest full-state version per opportunity" bodyClass="pb-1">
          <table className="tbl"><thead><tr><th>Stage</th><th className="text-right">Deals</th><th className="text-right">Face value</th><th className="text-right">→ next stage</th></tr></thead>
            <tbody>{s.stages.map((st) => { const conv = s.conversions.find((x) => x.from === st.stage); return (
              <tr key={st.stage}><td><StageTag stage={st.stage} /></td><td className="num text-right">{st.count}</td><td className="num text-right">{inr(st.proposed_inr)}</td>
                <td className="num text-right text-[11.5px]">{conv ? <>{pct(conv.value)} <span className="text-muted">({conv.num}/{conv.den})</span></> : <Tag dot={false}>terminal</Tag>}</td></tr>); })}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

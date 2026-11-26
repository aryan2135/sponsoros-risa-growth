"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, inr, dt, StageTag, Tag, Drawer, Empty, STAGE_LABEL } from "@/components/ui";
import type { Dashboard } from "@/lib/views";
import { NewTaskInline, NewOpportunity } from "@/components/forms";

type Opp = Dashboard["snapshot"]["opps"][number];
const STAGES = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"];

function OppDrawer({ o, onClose }: { o: Opp; onClose: () => void }) {
  const { data } = useDash(); const mutate = useMutate();
  const r = data!.readiness.find((x) => x.opportunity_id === o.opportunity_id);
  const [stage, setStage] = useState(o.stage); const [val, setVal] = useState(String(o.proposed_value_inr)); const [owner, setOwner] = useState(o.owner_id ?? ""); const [note, setNote] = useState("");
  const tasks = data!.tasks.filter((t) => t.opportunity_id === o.opportunity_id);
  const line = data!.snapshot.cash.lines.find((l) => l.opportunity_id === o.opportunity_id);
  return (
    <Drawer open onClose={onClose} title={<span>{o.brand_name} <span className="text-muted">· {o.opportunity_id}</span></span>}>
      <div className="space-y-4 text-[13px]">
        <div className="flex flex-wrap gap-2"><StageTag stage={o.stage} /><Tag tone={o.support_type === "cash" ? "teal" : "amber"}>{o.support_type === "cash" ? "Cash-type" : "In-kind (not cash)"}</Tag><Tag>{o.channel_group} · {o.campaign_name ?? "no campaign"}</Tag>{o.origin === "app" && <Tag tone="indigo">Created in app</Tag>}</div>
        <div className="grid grid-cols-3 gap-3">
          <div><p className="label">Proposed</p><p className="num font-semibold">{inr(o.proposed_value_inr)}</p></div>
          <div><p className="label">Confirmed</p><p className="num font-semibold">{inr(o.confirmed_value_inr)}</p></div>
          <div><p className="label">In stage</p><p className="num font-semibold">{Math.round(o.days_in_stage)} days</p></div>
          <div><p className="label">Brand met</p><p>{o.brand_met ? "Yes" : "No"}</p></div>
          <div><p className="label">Qualification</p><p>{o.brand_qualification ?? "—"}</p></div>
          <div><p className="label">Owner</p><p>{o.owner_name ?? "—"}</p></div>
        </div>
        {r && (
          <div className="rounded-lg border border-line bg-paper p-3">
            <div className="flex items-center justify-between"><p className="font-semibold">Next best action: {r.action}</p><Tag tone={r.band === "high" ? "green" : r.band === "medium" ? "amber" : "red"}>Readiness {r.score}/100</Tag></div>
            <ul className="mt-2 space-y-0.5 text-[12px] text-ink-2">{r.factors.map((f, i) => <li key={i} className="flex justify-between"><span>{f.label}</span><span className={`num ${f.points < 0 ? "text-rose-600" : "text-emerald-700"}`}>{f.points >= 0 ? "+" : ""}{f.points}</span></li>)}</ul>
            {r.missing.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Missing: {r.missing.join(", ")}</p>}
            <p className="mt-1 text-[11px] text-muted">Rule-based heuristic, not a trained payment probability.</p>
          </div>
        )}
        {line && <div className="rounded-lg border border-line p-3"><p className="label">Cash</p><p>Received {inr(line.received_verified_inr)} · outstanding {inr(line.outstanding_inr)} · scheduled {inr(line.scheduled_inr)} · status <b>{line.status}</b> — manage on the Cash page.</p></div>}
        <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={async (e) => { e.preventDefault(); await mutate("PATCH", `opportunities/${o.opportunity_id}`, { stage, proposed_value_inr: Number(val), owner_id: owner || null, note: note || undefined }, "New opportunity version saved"); }}>
          <p className="label">Update deal (appends a new full-state version at the operating clock)</p>
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
            <input className="input num" type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Proposed value" />
            <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Unassigned</option>{Object.entries(data!.team).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          </div>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          <button className="btn-primary justify-self-start">Save version</button>
        </form>
        <div><p className="label">Stage history</p>
          <ol className="space-y-1 text-[12px]">{o.versions.map((v) => <li key={v.history_id} className="flex justify-between gap-2"><span><StageTag stage={v.stage} /> <span className="text-muted">{v.history_id}{v.origin === "app" ? " (app)" : ""}</span></span><span className="num text-muted">{inr(v.proposed_value_inr, true)} · {dt(v.effective_at, true)}</span></li>)}</ol>
        </div>
        <div><p className="label">Tasks ({tasks.length})</p>{tasks.map((t) => <p key={t.id} className="text-[12px]">#{t.id} {t.title} — {t.status}</p>)}</div>
        <NewTaskInline defaults={{ opportunity_id: o.opportunity_id, brand_id: o.brand_id, owner_id: o.owner_id, title: r ? `${r.action}: ${o.brand_name} (${o.opportunity_id})` : "" }} />
      </div>
    </Drawer>
  );
}

function PipelineInner() {
  const { data } = useDash();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") === "queue" ? "queue" : "table");
  const [stage, setStage] = useState("open"); const [group, setGroup] = useState(""); const [q, setQ] = useState(""); const [staleOnly, setStaleOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const stale = Number(data?.settings.stale_days ?? 14);
  const rows = useMemo(() => (data?.snapshot.opps ?? []).filter((o) => (stage === "all" || (stage === "open" ? ["prospecting", "contacted", "proposal_sent", "negotiating"].includes(o.stage) : o.stage === stage)) && (!group || o.channel_group === group) && (!q || `${o.brand_name} ${o.opportunity_id} ${o.owner_name}`.toLowerCase().includes(q.toLowerCase())) && (!staleOnly || o.days_in_stage > stale)).sort((a, b) => b.proposed_value_inr - a.proposed_value_inr), [data, stage, group, q, staleOnly, stale]);
  if (!data) return <Loading />;
  const sOpp = data.snapshot.opps.find((o) => o.opportunity_id === sel);
  const readiness = new Map(data.readiness.map((r) => [r.opportunity_id, r]));
  return (
    <div className="space-y-4">
      <PageHeader title="Opportunity pipeline" subtitle="Latest full-state version of each partnership opportunity as of the operating clock. Edits append versions; source history is never overwritten." actions={<><div className="flex rounded-lg border border-line bg-white p-0.5">{["table", "queue"].map((v) => <button key={v} className={`rounded-md px-3 py-1 text-[12px] font-medium ${view === v ? "bg-ink text-white" : "text-ink-2"}`} onClick={() => setView(v)}>{v === "table" ? "Deals" : "Priority queue"}</button>)}</div><button className="btn-primary" onClick={() => setCreating(true)}>+ New opportunity</button></>} />
      {view === "queue" ? (
        <Card title="Cash readiness priority queue" subtitle="Sorted by urgency = score × value × stage weight. Collection track for confirmed cash deals; closing track for open deals." bodyClass="p-0">
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Action</th><th>Deal</th><th>Track</th><th>Value at stake</th><th>Score</th><th>Why (rule factors)</th></tr></thead>
            <tbody>{data.readiness.map((r) => <tr key={r.opportunity_id} className="cursor-pointer" onClick={() => setSel(r.opportunity_id)}><td className="font-medium text-ink">{r.action}</td><td>{r.brand_name}<p className="text-[11px] text-muted">{r.opportunity_id} · {r.owner_name ?? "unassigned"}</p></td><td><Tag tone={r.track === "collection" ? "teal" : "indigo"}>{r.track}</Tag></td><td className="num">{inr(r.value_inr)}</td><td><Tag tone={r.band === "high" ? "green" : r.band === "medium" ? "amber" : "red"}>{r.score}</Tag></td><td className="max-w-md text-[12px] text-muted">{r.why}</td></tr>)}</tbody></table></div>
        </Card>
      ) : (
        <Card bodyClass="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage filter"><option value="open">Open stages</option><option value="all">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
            <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Channel filter"><option value="">All channels</option><option value="warm">Warm / inbound</option><option value="cold">Cold</option></select>
            <input className="input w-56" placeholder="Search brand, ID, owner" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <label className="flex items-center gap-1.5 text-[12px] text-ink-2"><input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} /> Stale only (&gt;{stale}d)</label>
            <span className="ml-auto text-[12px] text-muted">{rows.length} deals · {inr(rows.reduce((a, o) => a + o.proposed_value_inr, 0))} face value</span>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="tbl"><thead><tr><th>Deal</th><th>Stage</th><th>Type</th><th>Proposed</th><th>Confirmed</th><th>Days in stage</th><th>Channel</th><th>Owner</th><th>Next action</th></tr></thead>
              <tbody>
                {rows.map((o) => { const r = readiness.get(o.opportunity_id); return (
                  <tr key={o.opportunity_id} className="cursor-pointer" onClick={() => setSel(o.opportunity_id)}>
                    <td><span className="font-medium text-ink">{o.brand_name}</span> <span className="id ml-1">{o.opportunity_id}</span></td>
                    <td><StageTag stage={o.stage} /></td><td>{o.support_type === "cash" ? "Cash" : <Tag tone="amber">In-kind</Tag>}</td>
                    <td className="num">{inr(o.proposed_value_inr)}</td><td className="num">{o.confirmed_value_inr ? inr(o.confirmed_value_inr) : "—"}</td>
                    <td className={`num ${o.days_in_stage > stale && ["prospecting", "contacted", "proposal_sent", "negotiating"].includes(o.stage) ? "font-semibold text-rose-600" : ""}`}>{Math.round(o.days_in_stage)}</td>
                    <td className="whitespace-nowrap text-[12px]"><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${o.channel_group === "warm" ? "bg-brand" : "bg-rose-400"}`} title={o.channel_group} />{o.campaign_name}</td><td>{o.owner_name ?? "—"}</td>
                    <td className="text-[12px]">{r ? <>{r.action} <span className="text-muted">({r.score})</span></> : "—"}</td>
                  </tr>); })}
              </tbody>
            </table>
            {!rows.length && <div className="p-4"><Empty>No deals match these filters.</Empty></div>}
          </div>
        </Card>
      )}
      {sOpp && <OppDrawer key={sOpp.opportunity_id + sOpp.versions.length} o={sOpp} onClose={() => setSel(null)} />}
      <NewOpportunity open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
export default function Pipeline() { return <Suspense fallback={<Loading />}><PipelineInner /></Suspense>; }

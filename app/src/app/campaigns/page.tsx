"use client";
import { useState } from "react";
import { useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, Tag, SignalTag, Modal, Field, inr, pct, LabelTag } from "@/components/ui";
import { NewTaskInline } from "@/components/forms";
import type { Dashboard } from "@/lib/views";

type Camp = Dashboard["snapshot"]["campaigns"][number];

function CampaignRow({ c }: { c: Camp }) {
  const { data } = useDash(); const mutate = useMutate();
  const [open, setOpen] = useState(false);
  const [spend, setSpend] = useState(""); const [budget, setBudget] = useState(c.budget_inr == null ? "" : String(c.budget_inr));
  const sig = data!.thresholds.filter((t) => t.scope === "campaign_rule" && t.metric_key.startsWith(`campaign.${c.id}.`));
  return (
    <>
      <tr className="cursor-pointer" onClick={() => setOpen(!open)}>
        <td><span className="font-medium text-ink">{c.name}</span> <span className="id ml-1">{c.id} · {c.channel} · {c.owner_name ?? "—"}{c.initiative_id && ` · ${c.initiative_id}`}</span></td>
        <td><Tag tone={c.status === "active" ? "teal" : c.status === "stopped" ? "red" : c.status === "paused" ? "amber" : "slate"}>{c.status}</Tag></td>
        <td className="num">{c.attempts}</td><td className="num">{c.brands_touched}</td><td className="num">{pct(c.meeting_rate.value)}</td><td className="num">{c.opportunities}</td><td className="num">{c.confirmed}</td>
        <td className="num">{pct(c.win_rate.value)} <span className="text-[11px] text-muted">({c.win_rate.num}/{c.win_rate.den})</span></td>
        <td className="num">{inr(c.confirmed_cash_inr, true)}</td><td className="num">{c.opt_outs}</td>
        <td className="num">{c.spend_known ? inr(c.spend_inr) : <span className="text-[11px] text-muted">not recorded</span>}</td>
        <td className="num">{c.cost_per_confirmed_inr != null ? inr(c.cost_per_confirmed_inr, true) : "—"}</td>
        <td>{sig.map((s) => <div key={s.metric_key} className="mb-0.5"><SignalTag signal={s.signal} /></div>)}</td>
      </tr>
      {open && (
        <tr><td colSpan={13} className="bg-paper/70">
          <div className="grid gap-4 py-2 md:grid-cols-3">
            <div className="space-y-2 text-[12px]">
              <p className="label">Rules (stored thresholds)</p>
              {sig.map((s) => <p key={s.metric_key}><b>{s.label}:</b> {s.evidence} → <SignalTag signal={s.signal} /> <span className="text-muted">{s.recommended_response}</span></p>)}
              <p className="text-muted">{c.objective}</p>
            </div>
            <div className="grid content-start gap-2">
              <p className="label">Status & budget</p>
              <div className="flex gap-1">{["active", "paused", "stopped"].map((s) => <button key={s} className={s === c.status ? "btn-primary" : "btn"} onClick={() => mutate("PATCH", `campaigns/${c.id}`, { status: s }, `Campaign ${s}`)}>{s}</button>)}</div>
              <div className="flex gap-1"><input className="input w-32 num" type="number" min={0} placeholder="Budget ₹" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Budget" /><button className="btn" onClick={() => mutate("PATCH", `campaigns/${c.id}`, { budget_inr: budget === "" ? null : Number(budget) }, "Budget saved")}>Save budget</button></div>
              <select className="input" value={c.initiative_id ?? ""} onChange={(e) => mutate("PATCH", `campaigns/${c.id}`, { initiative_id: e.target.value || null }, "Initiative link saved")} aria-label="Initiative"><option value="">No initiative</option>{data!.initiatives.map((i) => <option key={i.id} value={i.id}>{i.id} {i.name}</option>)}</select>
              <div className="flex gap-1"><input className="input w-32 num" type="number" min={1} placeholder="Spend ₹" value={spend} onChange={(e) => setSpend(e.target.value)} aria-label="Spend amount" /><button className="btn" onClick={async () => { if (await mutate("POST", `campaigns/${c.id}/spend`, { amount_inr: Number(spend) }, "Spend recorded — cost metrics recalculated")) setSpend(""); }}>Add spend</button></div>
              <p className="text-[11px] text-muted">Spend entries are dated at the operating clock. Budget {inr(c.budget_inr)} · spent {inr(c.spend_inr)}</p>
            </div>
            <NewTaskInline defaults={{ campaign_id: c.id, initiative_id: c.initiative_id, owner_id: c.owner_id, title: sig.some((s) => s.signal === "stop") ? `Pause new outreach on ${c.name}; redeploy closer time to warm sources` : "" }} />
          </div>
        </td></tr>
      )}
    </>
  );
}

function Initiative({ i }: { i: Dashboard["initiatives"][number] }) {
  const { data } = useDash(); const mutate = useMutate();
  const d = i.definition as Record<string, string | string[] | number>;
  const sigs = data!.thresholds.filter((t) => t.scope === "initiative" && t.scope_id === i.id);
  const defs = data!.threshold_defs.filter((t) => t.scope === "initiative" && t.scope_id === i.id);
  const [edit, setEdit] = useState<Record<number, { scale_at: string; stop_at: string }>>({});
  const tasks = data!.tasks.filter((t) => t.initiative_id === i.id);
  return (
    <Card title={<span><span className="mr-2 rounded bg-navy-900 px-1.5 py-0.5 text-[11px] text-white">#{i.rank}</span>{i.name}</span>} subtitle={`${i.id} · owner ${data!.team[i.owner_id ?? ""] ?? "—"} · budget ${inr(i.budget_inr)} · ${String(d.timeline)}`}
      action={<select className="input py-1" value={i.status} onChange={(e) => mutate("PATCH", `initiatives/${i.id}`, { status: e.target.value }, "Initiative status updated")} aria-label="Initiative status">{["active", "scaled", "changed", "stopped"].map((s) => <option key={s}>{s}</option>)}</select>}>
      <div className="grid gap-4 text-[12px] lg:grid-cols-2">
        <div className="space-y-1.5">
          <p><b>Concept:</b> {String(d.concept)}</p>
          <p><b>Experiment:</b> {String(d.experiment)}</p>
          <p><b>Leading KPIs:</b> {(d.kpis as string[]).join(" · ")}</p>
          <p className="text-emerald-700"><b>Scale:</b> {String(d.scale)}</p><p className="text-amber-700"><b>Change:</b> {String(d.change)}</p><p className="text-rose-700"><b>Stop:</b> {String(d.stop)}</p>
          <p className="text-muted">People: {String(d.people)} · confidence {String(d.confidence)} · first cash ~W{String(d.weeks_to_first_cash)}</p>
        </div>
        <div className="space-y-2">
          <p className="label">Live thresholds (editable)</p>
          {sigs.map((s) => { const def = defs.find((x) => x.metric_key === s.metric_key)!; const e = edit[def.id] ?? { scale_at: String(def.scale_at), stop_at: String(def.stop_at) }; return (
            <div key={s.metric_key} className="rounded-lg border border-line p-2">
              <div className="flex items-center justify-between"><b>{s.label}</b><SignalTag signal={s.signal} /></div>
              <p className="text-muted">Now: {s.value == null ? "—" : s.unit === "inr" ? inr(s.value) : s.unit === "ratio" ? pct(s.value, 1) : s.value} · {s.evidence}</p>
              <div className="mt-1 flex items-center gap-1">
                <span>scale {s.direction === "higher_better" ? "≥" : "≤"}</span><input className="input w-24 py-0.5 num" value={e.scale_at} onChange={(x) => setEdit({ ...edit, [def.id]: { ...e, scale_at: x.target.value } })} aria-label="Scale threshold" />
                <span>stop {s.direction === "higher_better" ? "<" : "≥"}</span><input className="input w-24 py-0.5 num" value={e.stop_at} onChange={(x) => setEdit({ ...edit, [def.id]: { ...e, stop_at: x.target.value } })} aria-label="Stop threshold" />
                <button className="btn py-0.5" onClick={() => mutate("PATCH", `thresholds/${def.id}`, { scale_at: Number(e.scale_at), stop_at: Number(e.stop_at) }, "Threshold updated — signals recomputed")}>Save</button>
              </div>
              {s.signal !== "insufficient_data" && <p className="mt-1 text-ink-2">→ {s.recommended_response}</p>}
            </div>); })}
          <p className="label mt-2">Tasks ({tasks.length})</p>
          {tasks.slice(0, 4).map((t) => <p key={t.id}>#{t.id} {t.title} — {t.status}</p>)}
        </div>
      </div>
    </Card>
  );
}

export default function Campaigns() {
  const { data } = useDash(); const mutate = useMutate();
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ campaign_name: "", channel: "introduction", objective: "", owner_id: "", budget_inr: "", initiative_id: "" });
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Campaigns & initiative playbook" subtitle="Campaign performance (observational attribution) with stored scale/stop rules, and the five ranked initiatives with editable thresholds evaluated against live data." actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ New campaign</button>} />
      <Card title="Acquisition campaigns" subtitle="Click a row to change status, budget, initiative link, record spend, or create a task" bodyClass="p-0">
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Campaign</th><th>Status</th><th>Attempts</th><th>Brands</th><th>Met %</th><th>Opps</th><th>Confirmed</th><th>Win rate</th><th>Cash conf.</th><th>Opt-outs</th><th>Spend</th><th>Cost / conf.</th><th>Rules</th></tr></thead>
          <tbody>{data.snapshot.campaigns.map((c) => <CampaignRow key={c.id} c={c} />)}</tbody></table></div>
        <p className="px-5 py-2.5 text-[11px] text-muted"><LabelTag kind="UNKNOWN" /> Historical spend is not in the source data; cost metrics appear only for spend recorded here.</p>
      </Card>
      <div className="space-y-4">{data.initiatives.map((i) => <Initiative key={i.id} i={i} />)}</div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New campaign">
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await mutate("POST", "campaigns", { ...f, owner_id: f.owner_id || null, initiative_id: f.initiative_id || null, budget_inr: f.budget_inr ? Number(f.budget_inr) : null, status: "active" }, "Campaign created"); if (r) setCreating(false); }}>
          <Field label="Name"><input className="input w-full" required minLength={3} value={f.campaign_name} onChange={(e) => setF({ ...f, campaign_name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel"><select className="input w-full" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{["introduction", "web_inbound", "email", "linkedin", "event", "other"].map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Owner"><select className="input w-full" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">Unassigned</option>{Object.entries(data.team).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
            <Field label="Budget (INR)"><input className="input w-full" type="number" min={0} value={f.budget_inr} onChange={(e) => setF({ ...f, budget_inr: e.target.value })} /></Field>
            <Field label="Initiative"><select className="input w-full" value={f.initiative_id} onChange={(e) => setF({ ...f, initiative_id: e.target.value })}><option value="">None</option>{data.initiatives.map((i) => <option key={i.id} value={i.id}>{i.id} {i.name}</option>)}</select></Field>
          </div>
          <Field label="Objective"><input className="input w-full" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></Field>
          <button className="btn-primary">Create</button>
        </form>
      </Modal>
    </div>
  );
}

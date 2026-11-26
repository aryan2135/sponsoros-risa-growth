"use client";
import { useEffect, useState } from "react";
import { api, useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, LabelTag, Field, dt, inr } from "@/components/ui";

type Assump = { sources: { id: string; name: string; initiative: string; basis: string; prospects: Record<string, number>; p_conversation: Record<string, number>; p_proposal: Record<string, number>; p_win: Record<string, number>; avg_deal_inr: Record<string, number> }[]; global: Record<string, Record<string, unknown>>; deprioritised: { name: string; reason: string }[] };

export default function DataPage() {
  const { data } = useDash(); const mutate = useMutate();
  const [a, setA] = useState<Assump | null>(null);
  const [auditLog, setAudit] = useState<{ id: number; at: string; actor: string; entity: string; entity_id: string; action: string }[]>([]);
  const [s, setS] = useState({ stale_days: "", prob: "", adv: "", advDays: "", balDays: "" });
  const [tg, setTg] = useState({ qualified: "", confirmed: "", cash: "", version: "Revised by team" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetEnabled, setResetEnabled] = useState(false);
  useEffect(() => { api<{ reset_enabled: boolean }>("GET", "meta").then((m) => setResetEnabled(m.reset_enabled)).catch(() => setResetEnabled(false)); }, []);
  useEffect(() => { api<{ assumptions: Assump }>("GET", "scenarios").then((r) => setA(r.assumptions)); api<typeof auditLog>("GET", "audit").then(setAudit); }, [data]);
  useEffect(() => {
    if (!data) return;
    const p = data.settings.collection_policy as { advance_pct: number; advance_due_days_after_signing: number; balance_due_days_before_festival: number };
    setS({ stale_days: String(data.settings.stale_days), prob: String(data.settings.forecast_collection_probability), adv: String(p.advance_pct), advDays: String(p.advance_due_days_after_signing), balDays: String(p.balance_due_days_before_festival) });
    const t = data.snapshot.targets;
    setTg((x) => ({ ...x, qualified: String(t?.qualified.goal ?? ""), confirmed: String(t?.confirmed.goal ?? ""), cash: String(t?.cash.goal ?? "") }));
  }, [data]);
  if (!data) return <Loading />;
  const src = data.source;
  return (
    <div className="space-y-4">
      <PageHeader title="Data sources & assumptions" subtitle="Provenance, data-quality decisions, known gaps, editable operating assumptions, and the audit trail." />
      <div className="flex flex-wrap gap-2 text-[12px]"><LabelTag kind="SOURCE" /> original dataset fact <LabelTag kind="CALCULATED" /> derived transparently <LabelTag kind="ASSUMPTION" /> planning assumption <LabelTag kind="SIMULATION" /> model output <LabelTag kind="UNKNOWN" /> not established by data</div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="Source import" subtitle="Raw rows are preserved unchanged in raw_records; app edits are separate, versioned and audited">
          {src && <div className="space-y-2 text-[13px]">
            <p><b>{src.file_name}</b> · imported {dt(src.imported_at, true)}</p>
            <p className="font-mono text-[11px] break-all text-muted">SHA-256 {src.sha256}</p>
            <table className="tbl"><thead><tr><th>Sheet</th><th>Rows read</th><th>Exact import retries removed</th></tr></thead>
              <tbody>{Object.entries(src.row_counts).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td><td className="text-[12px]">{src.dedupe_log[k]?.length ? src.dedupe_log[k].join(", ") : "—"}</td></tr>)}</tbody></table>
            <p className="text-[12px] text-muted">Import is idempotent (keyed by file SHA-256 and stable IDs). A repeated ID with a different payload would abort the import, never pick a version silently.</p>
          </div>}
        </Card>
        <Card title="Known data gaps" subtitle="The AI analyst checks these before answering">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
            <li><LabelTag kind="UNKNOWN" /> <b>Historical cash received</b> — no receipts, invoices or payment dates in the source.</li>
            <li><LabelTag kind="UNKNOWN" /> <b>Campaign spend → CAC / ROI</b> — no budget or spend columns.</li>
            <li><b>Causality</b> — campaign attribution is observational (originating campaign at opportunity creation).</li>
            <li><b>Loss reasons</b>, sponsor budgets, contract documents and tax are not recorded.</li>
            <li><b>Synthetic patterns</b> — every confirmed deal passed through all four stages; 19 of 24 confirmed brands share two name prefixes; confirmed value always equals proposed. Forward rates are therefore haircut, not copied.</li>
            <li><b>Edits and the clock</b> — edits are stamped at the operating clock; a change earlier than a record&apos;s latest version is refused rather than rewriting history.</li>
          </ul>
        </Card>
        <Card title="Operating assumptions" subtitle="Used by the live forecast, staleness rules and payment-schedule generator">
          <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); mutate("PATCH", "settings", { stale_days: Number(s.stale_days), forecast_collection_probability: Number(s.prob), collection_policy: { advance_pct: Number(s.adv), advance_due_days_after_signing: Number(s.advDays), balance_due_days_before_festival: Number(s.balDays) } }, "Assumptions saved — analytics recomputed"); }}>
            <Field label="Stale after (days in stage)"><input className="input w-full num" type="number" min={1} value={s.stale_days} onChange={(e) => setS({ ...s, stale_days: e.target.value })} /></Field>
            <Field label="Collection probability (forecast)" hint="[ASSUMPTION] base-model blended 0.84 (model v1.1.0)"><input className="input w-full num" type="number" min={0} max={1} step={0.01} value={s.prob} onChange={(e) => setS({ ...s, prob: e.target.value })} /></Field>
            <Field label="Advance % at signing"><input className="input w-full num" type="number" min={0} max={1} step={0.05} value={s.adv} onChange={(e) => setS({ ...s, adv: e.target.value })} /></Field>
            <Field label="Advance due (days after signing)"><input className="input w-full num" type="number" min={0} value={s.advDays} onChange={(e) => setS({ ...s, advDays: e.target.value })} /></Field>
            <Field label="Balance due (days before festival)"><input className="input w-full num" type="number" min={0} value={s.balDays} onChange={(e) => setS({ ...s, balDays: e.target.value })} /></Field>
            <div className="flex items-end"><button className="btn-primary">Save assumptions</button></div>
          </form>
        </Card>
        <Card title="Targets" subtitle={`Current: ${data.snapshot.targets?.version ?? "—"} — ${data.snapshot.targets?.basis ?? ""}`}>
          <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); mutate("POST", "targets", { target_version: tg.version, qualified_brands_goal: tg.qualified ? Number(tg.qualified) : null, confirmed_partnerships_goal: tg.confirmed ? Number(tg.confirmed) : null, cash_collection_goal_inr: tg.cash ? Number(tg.cash) : null, basis: "[USER] edited in SponsorOS" }, "New target version saved"); }}>
            <Field label="Qualified brands goal"><input className="input w-full num" type="number" value={tg.qualified} onChange={(e) => setTg({ ...tg, qualified: e.target.value })} /></Field>
            <Field label="Confirmed partnerships goal"><input className="input w-full num" type="number" value={tg.confirmed} onChange={(e) => setTg({ ...tg, confirmed: e.target.value })} /></Field>
            <Field label="Cash collection goal (INR)"><input className="input w-full num" type="number" value={tg.cash} onChange={(e) => setTg({ ...tg, cash: e.target.value })} /></Field>
            <Field label="Version label"><input className="input w-full" value={tg.version} onChange={(e) => setTg({ ...tg, version: e.target.value })} /></Field>
            <button className="btn-primary justify-self-start">Save as new version</button>
          </form>
        </Card>
        <Card title="Readiness engine rules" subtitle="Transparent heuristic — not a trained probability">
          {Object.entries(data.readiness_rules).map(([k, rules]) => <div key={k} className="mb-2"><p className="label">{k} track</p><ul className="list-disc pl-5 text-[12px] text-ink-2">{rules.map((r) => <li key={r}>{r}</li>)}</ul></div>)}
        </Card>
        <Card title="Deprioritised / rejected ideas">
          <ul className="space-y-2 text-[12px] text-ink-2">{a?.deprioritised.map((d) => <li key={d.name}><b>{d.name}.</b> {d.reason}</li>)}</ul>
        </Card>
      </div>
      <Card title="Forecast model assumptions (next edition)" subtitle="model/assumptions.json — bau / base / stretch per source" bodyClass="p-0">
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Source</th><th>Init.</th><th>Prospects</th><th>→ Conversation</th><th>→ Proposal</th><th>→ Win</th><th>Avg deal</th><th className="min-w-[320px]">Basis</th></tr></thead>
          <tbody>{a?.sources.map((x) => <tr key={x.id}><td className="min-w-[200px] font-medium text-ink">{x.name} <span className="id">{x.id}</span></td><td>{x.initiative}</td>{(["prospects", "p_conversation", "p_proposal", "p_win"] as const).map((k) => <td key={k} className="num text-[12px]">{x[k].bau} / {x[k].base} / {x[k].stretch}</td>)}<td className="num text-[12px]">{inr(x.avg_deal_inr.bau, true)} / {inr(x.avg_deal_inr.base, true)} / {inr(x.avg_deal_inr.stretch, true)}</td><td className="text-[11px] text-muted">{x.basis}</td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Audit trail (latest 100)" bodyClass="p-0">
          <div className="max-h-80 overflow-auto"><table className="tbl"><thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>Action</th></tr></thead><tbody>{!auditLog.length && <tr><td colSpan={4} className="py-4 text-center text-muted">No changes yet. Every write (UI or AI-confirmed) is logged here with before/after values.</td></tr>}{auditLog.map((x) => <tr key={x.id}><td className="text-[12px]">{new Date(x.at).toLocaleString("en-IN")}</td><td>{x.actor}</td><td>{x.entity} {x.entity_id}</td><td>{x.action}</td></tr>)}</tbody></table></div>
        </Card>
        <Card title="Reset demo data">
          <p className="text-[12px] text-ink-2">Restores the operational layer to the imported workbook: removes app-created records, tasks, receipts, milestones, spend, scenarios and settings. Raw source rows are untouched.</p>
          {!resetEnabled ? <p className="mt-3 text-[12px] font-medium text-muted">Disabled on this deployment (ALLOW_RESET is not &quot;true&quot;).</p> : !confirmReset ? <button className="btn mt-3 text-rose-700" onClick={() => setConfirmReset(true)}>Reset to source…</button> : <div className="mt-3 flex gap-2"><button className="btn-primary bg-rose-700" onClick={async () => { await mutate("POST", "admin/reset", {}, "Reset to source data"); setConfirmReset(false); }}>Confirm reset</button><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button></div>}
        </Card>
      </div>
    </div>
  );
}

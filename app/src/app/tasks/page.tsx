"use client";
import { useState } from "react";
import { useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, Tag, dt, Empty } from "@/components/ui";
import { NewTaskInline } from "@/components/forms";

export default function Tasks() {
  const { data } = useDash(); const mutate = useMutate();
  const [status, setStatus] = useState("active"); const [owner, setOwner] = useState("");
  const [outcome, setOutcome] = useState<Record<number, string>>({});
  if (!data) return <Loading />;
  const now = data.as_of;
  const rows = data.tasks.filter((t) => (status === "all" || (status === "active" ? ["open", "in_progress"].includes(t.status) : t.status === status)) && (!owner || t.owner_id === owner)).sort((a, b) => (a.due_at || 9e15) - (b.due_at || 9e15));
  const recs = data.recommendations;
  return (
    <div className="space-y-4">
      <PageHeader title="Tasks & decisions" subtitle="Execution layer. Every AI or readiness recommendation is logged with its evidence and decision; approved ones become tasks, and recorded outcomes flow back to the recommendation." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={`Tasks (${rows.length})`} bodyClass="p-0" action={<div className="flex gap-2">
          <select className="input py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="active">Open & in progress</option><option value="all">All</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select>
          <select className="input py-1" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner filter"><option value="">All owners</option>{Object.entries(data.team).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>}>
          {rows.length ? (
            <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Links</th><th>Status</th><th>Outcome</th></tr></thead>
              <tbody>{rows.map((t) => { const overdue = ["open", "in_progress"].includes(t.status) && t.due_at && t.due_at < now; return (
                <tr key={t.id}>
                  <td><p className="font-medium text-ink">#{t.id} {t.title}</p><p className="text-[11px] text-muted">{t.created_by.replace("_", " ")}{t.recommendation_id && ` · rec #${t.recommendation_id}`}</p></td>
                  <td><select className="input py-0.5 text-[12px]" value={t.owner_id ?? ""} onChange={(e) => mutate("PATCH", `tasks/${t.id}`, { owner_id: e.target.value || null }, "Owner updated")} aria-label="Owner"><option value="">—</option>{Object.entries(data.team).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
                  <td className={overdue ? "font-semibold text-rose-600" : ""}>{dt(t.due_at)}{overdue && " · overdue"}</td>
                  <td><Tag tone={t.priority === "high" ? "red" : t.priority === "medium" ? "amber" : "slate"}>{t.priority}</Tag></td>
                  <td className="text-[11px] text-muted">{[t.opportunity_id, t.brand_id, t.campaign_id, t.initiative_id].filter(Boolean).join(" · ") || "—"}</td>
                  <td><select className="input py-0.5 text-[12px]" value={t.status} onChange={(e) => mutate("PATCH", `tasks/${t.id}`, { status: e.target.value }, `Task ${e.target.value}`)} aria-label="Status">{["open", "in_progress", "done", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td>{t.outcome ? <span className="text-[12px]">{t.outcome}</span> : <div className="flex gap-1"><input className="input w-36 py-0.5 text-[12px]" placeholder="Record outcome" value={outcome[t.id] ?? ""} onChange={(e) => setOutcome({ ...outcome, [t.id]: e.target.value })} aria-label="Outcome" /><button className="btn py-0.5 text-[11px]" onClick={() => outcome[t.id] && mutate("PATCH", `tasks/${t.id}`, { outcome: outcome[t.id] }, "Outcome recorded")}>Save</button></div>}</td>
                </tr>); })}</tbody></table></div>
          ) : <div className="p-5"><Empty>No tasks here. Create one, or confirm a proposal from the AI analyst or the readiness queue.</Empty></div>}
        </Card>
        <div className="space-y-4"><NewTaskInline defaults={{}} /></div>
      </div>
      <Card title="Decision log" subtitle="Issue → evidence → diagnosis → action → decision → task → outcome" bodyClass="p-0">
        {recs.length ? (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>#</th><th>Issue & evidence</th><th>Action</th><th>Decision</th><th>Task</th><th>Outcome</th></tr></thead>
            <tbody>{recs.map((r) => (
              <tr key={r.id}><td className="num">{r.id}<p className="text-[11px] text-muted">{r.source}</p></td>
                <td className="max-w-lg"><p className="font-medium text-ink">{r.issue}</p><p className="text-[12px] text-muted">{typeof r.evidence === "object" && r.evidence ? String((r.evidence as Record<string, unknown>).summary ?? JSON.stringify(r.evidence)) : String(r.evidence)}</p>{r.diagnosis && <p className="text-[12px] text-muted">Diagnosis: {r.diagnosis}</p>}</td>
                <td className="text-[12px]">{r.action}{r.expected_impact && <p className="text-muted">{r.expected_impact}</p>}</td>
                <td><Tag tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status}</Tag><p className="text-[11px] text-muted">{dt(r.decided_at, true)}</p></td>
                <td className="num">{r.task_id ? `#${r.task_id}` : "—"}</td><td className="text-[12px]">{r.outcome ?? "—"}</td></tr>))}</tbody></table></div>
        ) : <div className="p-5"><Empty>No decisions yet. Ask the analyst “which sponsors need immediate intervention?” and confirm a proposed task.</Empty></div>}
      </Card>
    </div>
  );
}

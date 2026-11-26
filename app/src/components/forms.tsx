"use client";
import { useState } from "react";
import { useDash, useMutate } from "@/lib/client";
import { Modal, Field, STAGE_LABEL } from "@/components/ui";

const STAGES = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"];

export function NewTaskInline({ defaults, onDone }: { defaults: Record<string, unknown>; onDone?: () => void }) {
  const { data } = useDash(); const mutate = useMutate();
  const [f, setF] = useState({ title: String(defaults.title ?? ""), owner_id: String(defaults.owner_id ?? ""), due: "", priority: "medium" });
  return (
    <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={async (e) => { e.preventDefault(); const r = await mutate("POST", "tasks", { ...defaults, title: f.title, owner_id: f.owner_id || null, due_at: f.due ? new Date(f.due + "T18:00:00+05:30").toISOString() : null, priority: f.priority }, "Task created"); if (r) onDone?.(); }}>
      <p className="label">New task</p>
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Task" aria-label="Task title" />
      <div className="grid grid-cols-3 gap-2">
        <select className="input" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} aria-label="Owner"><option value="">Unassigned</option>{Object.entries(data?.team ?? {}).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <input type="date" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} aria-label="Due" />
        <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority"><option>high</option><option>medium</option><option>low</option></select>
      </div>
      <button className="btn-primary justify-self-start">Add task</button>
    </form>
  );
}

export function NewOpportunity({ open, onClose, brandId }: { open: boolean; onClose: () => void; brandId?: string }) {
  const { data } = useDash(); const mutate = useMutate();
  const [f, setF] = useState({ brand_id: brandId ?? "", support_type: "cash", proposed_value_inr: "100000", campaign_id: "", owner_id: "", stage: "prospecting", primary_contact_id: "" });
  if (!data) return null;
  const contacts = data.contacts.filter((c) => c.brand_id === f.brand_id);
  return (
    <Modal open={open} onClose={onClose} title="New opportunity">
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await mutate("POST", "opportunities", { ...f, proposed_value_inr: Number(f.proposed_value_inr), campaign_id: f.campaign_id || null, owner_id: f.owner_id || null, primary_contact_id: f.primary_contact_id || null }, "Opportunity created"); if (r) onClose(); }}>
        <Field label="Brand"><select className="input w-full" required value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value, primary_contact_id: "" })}><option value="">Select…</option>{[...data.brands].sort((a, b) => a.brand_name.localeCompare(b.brand_name)).map((b) => <option key={b.brand_id} value={b.brand_id} disabled={b.opted_out}>{b.brand_name} ({b.brand_id}){b.opted_out ? " — opted out" : ""}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Support type"><select className="input w-full" value={f.support_type} onChange={(e) => setF({ ...f, support_type: e.target.value })}><option value="cash">Cash</option><option value="in_kind">In-kind</option></select></Field>
          <Field label="Proposed value (INR)"><input className="input w-full" type="number" min={0} required value={f.proposed_value_inr} onChange={(e) => setF({ ...f, proposed_value_inr: e.target.value })} /></Field>
          <Field label="Originating campaign"><select className="input w-full" value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">None</option>{data.snapshot.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Owner"><select className="input w-full" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">Unassigned</option>{Object.entries(data.team).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
          <Field label="Primary contact"><select className="input w-full" value={f.primary_contact_id} onChange={(e) => setF({ ...f, primary_contact_id: e.target.value })}><option value="">None</option>{contacts.map((c) => <option key={c.contact_id} value={c.contact_id}>{c.contact_name}</option>)}</select></Field>
          <Field label="Starting stage"><select className="input w-full" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{STAGES.slice(0, 5).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></Field>
        </div>
        <button className="btn-primary">Create opportunity</button>
      </form>
    </Modal>
  );
}


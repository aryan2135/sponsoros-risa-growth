"use client";
import { useMemo, useState } from "react";
import { useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, Tag, Drawer, Modal, Field, StageTag, dt, inr, Empty } from "@/components/ui";
import { NewOpportunity, NewTaskInline } from "@/components/forms";

const INDUSTRIES = ["Food and beverage", "Consumer products", "Mobility", "Education", "Media", "Personal care", "Fintech", "Gaming", "Other"];
const QUAL = ["unreviewed", "engaged", "qualified", "unqualified", "dormant"];
const qTone = (q: string | null) => (q === "qualified" ? "green" : q === "engaged" ? "teal" : q === "unqualified" ? "red" : q === "dormant" ? "amber" : "slate") as "green";

function BrandDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useDash(); const mutate = useMutate();
  const b = data!.brands.find((x) => x.brand_id === id)!;
  const [edit, setEdit] = useState({ brand_name: b.brand_name, industry: b.industry, owner_id: b.owner_id ?? "", notes: b.notes ?? "" });
  const [qual, setQual] = useState({ status: b.qualification ?? "engaged", reason: "" });
  const [ct, setCt] = useState({ contact_name: "", job_title: "", email: "" });
  const [ix, setIx] = useState({ event_type: "outreach_sent", campaign_id: "", contact_id: "", summary: "" });
  const [newOpp, setNewOpp] = useState(false);
  const contacts = data!.contacts.filter((c) => c.brand_id === id);
  const opps = data!.snapshot.opps.filter((o) => o.brand_id === id);
  return (
    <Drawer open onClose={onClose} title={<span>{b.brand_name} <span className="text-muted">· {b.brand_id}</span></span>} width="max-w-2xl">
      <div className="space-y-4 text-[13px]">
        <div className="flex flex-wrap gap-2"><Tag tone={qTone(b.qualification)}>{b.qualification ?? "no status"}</Tag><Tag>{b.industry}</Tag>{b.met && <Tag tone="teal">Met</Tag>}{b.opted_out && <Tag tone="red">Opted out — do not contact</Tag>}{b.origin === "app" && <Tag tone="indigo">Created in app</Tag>}</div>
        {b.qualification_reason && <p className="text-ink-2">{b.qualification_reason}</p>}
        <div>
          <div className="mb-1 flex items-center justify-between"><p className="label">Opportunities</p><button className="btn-ghost" onClick={() => setNewOpp(true)} disabled={b.opted_out}>+ New opportunity</button></div>
          {opps.length ? opps.map((o) => <div key={o.opportunity_id} className="flex justify-between border-b border-line py-1.5"><span>{o.opportunity_id} <StageTag stage={o.stage} /> {o.support_type === "in_kind" && <Tag tone="amber">in-kind</Tag>}</span><span className="num">{inr(o.confirmed_value_inr || o.proposed_value_inr)} · {o.owner_name ?? "—"}</span></div>) : <p className="text-muted">No opportunity yet.</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); mutate("PATCH", `brands/${id}`, { ...edit, owner_id: edit.owner_id || null }, "Brand updated"); }}>
            <p className="label">Edit brand</p>
            <input className="input" value={edit.brand_name} onChange={(e) => setEdit({ ...edit, brand_name: e.target.value })} aria-label="Brand name" />
            <select className="input" value={edit.industry} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} aria-label="Industry">{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select>
            <select className="input" value={edit.owner_id} onChange={(e) => setEdit({ ...edit, owner_id: e.target.value })} aria-label="Owner"><option value="">Unassigned</option>{Object.entries(data!.team).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            <textarea className="input" rows={2} placeholder="Notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} aria-label="Notes" />
            <button className="btn-primary justify-self-start">Save</button>
          </form>
          <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); mutate("POST", `brands/${id}/qualification`, qual, "Qualification version recorded"); }}>
            <p className="label">Qualification (new version)</p>
            <select className="input" value={qual.status} onChange={(e) => setQual({ ...qual, status: e.target.value })} aria-label="Status">{QUAL.map((q) => <option key={q}>{q}</option>)}</select>
            <input className="input" required minLength={3} placeholder="Reason / evidence" value={qual.reason} onChange={(e) => setQual({ ...qual, reason: e.target.value })} aria-label="Reason" />
            <button className="btn-primary justify-self-start">Record</button>
          </form>
          <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); mutate("POST", "contacts", { brand_id: id, ...ct }, "Contact added"); }}>
            <p className="label">Add contact</p>
            <input className="input" required minLength={2} placeholder="Name" value={ct.contact_name} onChange={(e) => setCt({ ...ct, contact_name: e.target.value })} aria-label="Contact name" />
            <input className="input" placeholder="Job title" value={ct.job_title} onChange={(e) => setCt({ ...ct, job_title: e.target.value })} aria-label="Job title" />
            <input className="input" type="email" placeholder="Email" value={ct.email} onChange={(e) => setCt({ ...ct, email: e.target.value })} aria-label="Email" />
            <button className="btn-primary justify-self-start">Add</button>
          </form>
          <form className="grid gap-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); mutate("POST", "interactions", { brand_id: id, event_type: ix.event_type, campaign_id: ix.campaign_id || null, contact_id: ix.contact_id || null, summary: ix.summary || undefined }, "Interaction logged"); }}>
            <p className="label">Log interaction</p>
            <select className="input" value={ix.event_type} onChange={(e) => setIx({ ...ix, event_type: e.target.value })} aria-label="Event type">{["outreach_sent", "introduction_received", "web_inbound", "replied", "meeting_booked", "meeting_held", "opt_out"].map((t) => <option key={t}>{t}</option>)}</select>
            <select className="input" value={ix.campaign_id} onChange={(e) => setIx({ ...ix, campaign_id: e.target.value })} aria-label="Campaign"><option value="">Campaign (root touches)…</option>{data!.snapshot.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="input" value={ix.contact_id} onChange={(e) => setIx({ ...ix, contact_id: e.target.value })} aria-label="Contact"><option value="">Contact…</option>{contacts.map((c) => <option key={c.contact_id} value={c.contact_id}>{c.contact_name}</option>)}</select>
            <input className="input" placeholder="Summary" value={ix.summary} onChange={(e) => setIx({ ...ix, summary: e.target.value })} aria-label="Summary" />
            <button className="btn-primary justify-self-start">Log</button>
          </form>
        </div>
        <div><p className="label">Contacts ({contacts.length})</p>{contacts.map((c) => <p key={c.contact_id} className="text-[12px]">{c.contact_name} · {c.job_title ?? "—"} {c.email && `· ${c.email}`} <span className="text-muted">({c.contact_id})</span></p>)}</div>
        <NewTaskInline defaults={{ brand_id: id, owner_id: b.owner_id, title: "" }} />
        <p className="text-[11px] text-muted">Created {dt(b.created_at)} · {b.interactions} interactions · last touch {dt(b.last_touch_at)}</p>
      </div>
      <NewOpportunity open={newOpp} onClose={() => setNewOpp(false)} brandId={id} />
    </Drawer>
  );
}

export default function Sponsors() {
  const { data } = useDash(); const mutate = useMutate();
  const [q, setQ] = useState(""); const [qual, setQual] = useState(""); const [ind, setInd] = useState(""); const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const [nb, setNb] = useState({ brand_name: "", industry: INDUSTRIES[0], owner_id: "" });
  const rows = useMemo(() => (data?.brands ?? []).filter((b) => (!q || `${b.brand_name} ${b.brand_id}`.toLowerCase().includes(q.toLowerCase())) && (!qual || (qual === "no_opp" ? b.qualification === "qualified" && !b.opportunities.length : b.qualification === qual)) && (!ind || b.industry === ind)).sort((a, b) => (b.last_touch_at ?? 0) - (a.last_touch_at ?? 0)), [data, q, qual, ind]);
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Sponsor CRM" subtitle={`${data.brands.length} brands · ${data.contacts.length} contacts. Brands, contacts, outreach attempts and opportunities are separate populations. Qualification is a full-state history: changes add versions.`} actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ New brand</button>} />
      {data.snapshot.qualified_without_opportunity.length > 0 && (
        <button onClick={() => setQual("no_opp")} className="w-full rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-left text-[13px] text-teal-900"><b>{data.snapshot.qualified_without_opportunity.length} qualified brands have no opportunity</b> — the fastest pipeline to recover (initiative I3). Click to filter.</button>
      )}
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <input className="input w-60" placeholder="Search brands" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search brands" />
          <select className="input" value={qual} onChange={(e) => setQual(e.target.value)} aria-label="Qualification filter"><option value="">All statuses</option>{QUAL.map((x) => <option key={x}>{x}</option>)}<option value="no_opp">qualified, no opportunity</option></select>
          <select className="input" value={ind} onChange={(e) => setInd(e.target.value)} aria-label="Industry filter"><option value="">All industries</option>{INDUSTRIES.map((x) => <option key={x}>{x}</option>)}</select>
          <span className="ml-auto self-center text-[12px] text-muted">{rows.length} brands</span>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="tbl"><thead><tr><th>Brand</th><th>Industry</th><th>Owner</th><th>Status</th><th>Contacts</th><th>Touches</th><th>Last touch</th><th>Opportunities</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.brand_id} className="cursor-pointer" onClick={() => setSel(b.brand_id)}>
                <td><span className="font-medium text-ink">{b.brand_name}</span> <span className="id ml-1">{b.brand_id}{b.opted_out && " · opted out"}</span></td><td>{b.industry}</td><td>{b.owner_name ?? "—"}</td>
                <td><Tag tone={qTone(b.qualification)}>{b.qualification ?? "—"}</Tag></td><td className="num">{b.contacts}</td><td className="num">{b.interactions}</td><td>{dt(b.last_touch_at)}</td>
                <td>{b.opportunities.map((o) => <span key={o.id} className="mr-1"><StageTag stage={o.stage} /></span>)}</td>
              </tr>))}</tbody></table>
          {!rows.length && <div className="p-4"><Empty>No brands match.</Empty></div>}
        </div>
      </Card>
      {sel && <BrandDrawer key={sel} id={sel} onClose={() => setSel(null)} />}
      <Modal open={creating} onClose={() => setCreating(false)} title="New brand">
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await mutate<{ brand_id: string }>("POST", "brands", { ...nb, owner_id: nb.owner_id || null }, "Brand created"); if (r) { setCreating(false); setSel(r.brand_id); } }}>
          <Field label="Brand name"><input className="input w-full" required minLength={2} value={nb.brand_name} onChange={(e) => setNb({ ...nb, brand_name: e.target.value })} /></Field>
          <Field label="Industry"><select className="input w-full" value={nb.industry} onChange={(e) => setNb({ ...nb, industry: e.target.value })}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select></Field>
          <Field label="Owner"><select className="input w-full" value={nb.owner_id} onChange={(e) => setNb({ ...nb, owner_id: e.target.value })}><option value="">Unassigned</option>{Object.entries(data.team).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
          <button className="btn-primary">Create</button>
        </form>
      </Modal>
    </div>
  );
}

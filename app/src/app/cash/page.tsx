"use client";
import { useState } from "react";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { useDash, useMutate } from "@/lib/client";
import { Card, PageHeader, Loading, Stat, inr, dt, CashTag, Tag, Drawer, Field, LabelTag, toLocalInput, fromLocalInput } from "@/components/ui";
import type { Dashboard } from "@/lib/views";

type Line = Dashboard["snapshot"]["cash"]["lines"][number];

function LineDrawer({ l, onClose }: { l: Line; onClose: () => void }) {
  const { data } = useDash(); const mutate = useMutate();
  const [m, setM] = useState({ label: "Milestone", amount: "", due: toLocalInput(data!.as_of) });
  const [r, setR] = useState({ amount: "", milestone_id: "", reference: "", received: toLocalInput(data!.as_of), verified: false, is_test: true, note: "" });
  const [inv, setInv] = useState<Record<number, string>>({});
  const receipts = l.receipts;
  return (
    <Drawer open onClose={onClose} title={<span>{l.brand_name} <span className="text-slate-400">· {l.opportunity_id}</span></span>}>
      <div className="space-y-4 text-[13px]">
        <div className="grid grid-cols-3 gap-3">
          <div><p className="label">Confirmed cash</p><p className="num font-semibold">{inr(l.confirmed_cash_inr)}</p></div>
          <div><p className="label">Verified received</p><p className="num font-semibold text-emerald-700">{inr(l.received_verified_inr)}</p></div>
          <div><p className="label">Outstanding</p><p className="num font-semibold">{inr(l.outstanding_inr)}</p></div>
        </div>
        <div className="flex items-center justify-between"><CashTag status={l.status} />{!l.milestones.length && <button className="btn-teal" onClick={() => mutate("POST", "cash/schedule", { opportunity_id: l.opportunity_id }, "Payment schedule generated from policy")}>Generate schedule from policy</button>}</div>
        <div>
          <p className="label">Payment milestones</p>
          {l.milestones.length ? (
            <table className="tbl"><thead><tr><th>Milestone</th><th>Amount</th><th>Due</th><th>Paid</th><th>Status</th><th></th></tr></thead>
              <tbody>{l.milestones.map((x) => (
                <tr key={x.id}><td>{x.label}<p className="text-[11px] text-slate-400">{x.basis === "policy_generated" ? "[ASSUMPTION] policy" : "user"} · #{x.id}</p></td><td className="num">{inr(x.amount_inr)}</td>
                  <td className={x.overdue ? "font-semibold text-rose-600" : ""}>{dt(x.due_at)}{x.overdue && " · overdue"}</td><td className="num">{inr(x.paid_inr)}</td>
                  <td>{x.status === "invoiced" ? <Tag tone="teal">Invoiced {x.invoice_number}</Tag> : <Tag>{x.status}</Tag>}</td>
                  <td className="space-y-1">
                    {x.status === "planned" && <div className="flex gap-1"><input className="input w-24 py-0.5 text-[11px]" placeholder="INV-no" value={inv[x.id] ?? ""} onChange={(e) => setInv({ ...inv, [x.id]: e.target.value })} aria-label="Invoice number" /><button className="btn py-0.5 text-[11px]" onClick={() => mutate("PATCH", `cash/milestones/${x.id}`, { status: "invoiced", invoice_number: inv[x.id] }, "Marked invoiced")}>Invoice</button></div>}
                    <button className="btn-ghost text-[11px] text-rose-600" onClick={() => mutate("PATCH", `cash/milestones/${x.id}`, { status: "cancelled" }, "Milestone cancelled")}>Cancel</button>
                  </td></tr>))}</tbody></table>
          ) : <p className="text-slate-500">No payment schedule. This commitment is at risk until it is invoiced.</p>}
          <form className="mt-2 grid grid-cols-[1fr_110px_170px_auto] gap-2" onSubmit={(e) => { e.preventDefault(); mutate("POST", "cash/milestones", { opportunity_id: l.opportunity_id, label: m.label, amount_inr: Number(m.amount), due_at: fromLocalInput(m.due) }, "Milestone added"); }}>
            <input className="input" value={m.label} onChange={(e) => setM({ ...m, label: e.target.value })} aria-label="Milestone label" />
            <input className="input num" type="number" min={1} required placeholder="₹" value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })} aria-label="Milestone amount" />
            <input className="input" type="datetime-local" value={m.due} onChange={(e) => setM({ ...m, due: e.target.value })} aria-label="Due" />
            <button className="btn">Add</button>
          </form>
        </div>
        <div>
          <p className="label">Receipts</p>
          {receipts.length ? <ul className="space-y-1 text-[12px]">{receipts.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span>{inr(x.amount_inr)} · {dt(x.received_at)} · ref {x.reference} {x.is_test && <Tag tone="indigo">TEST</Tag>} {x.verified ? <Tag tone="green">verified</Tag> : <Tag tone="amber">unverified</Tag>}</span>{!x.verified && <button className="btn-ghost" onClick={() => mutate("PATCH", `cash/receipts/${x.id}`, { verified: true }, "Receipt verified")}>Verify</button>}</li>)}</ul> : <p className="text-slate-500">No receipts recorded.</p>}
          <form className="mt-2 grid gap-2 rounded-lg border border-slate-200 p-3" onSubmit={async (e) => { e.preventDefault(); const ok = await mutate("POST", "cash/receipts", { opportunity_id: l.opportunity_id, amount_inr: Number(r.amount), milestone_id: r.milestone_id ? Number(r.milestone_id) : null, reference: r.reference, received_at: fromLocalInput(r.received), verified: r.verified, is_test: r.is_test, note: r.note || undefined }, r.is_test ? "Test receipt recorded (excluded from cash totals)" : "Receipt recorded"); if (ok) setR((x) => ({ ...x, amount: "", reference: "", note: "" })); }}>
            <p className="label">Record receipt (from bank evidence)</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Amount"><input className="input w-full num" type="number" min={1} required value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} /></Field>
              <Field label="Bank ref / UTR"><input className="input w-full" required minLength={3} value={r.reference} onChange={(e) => setR({ ...r, reference: e.target.value })} /></Field>
              <Field label="Received"><input className="input w-full" type="datetime-local" value={r.received} onChange={(e) => setR({ ...r, received: e.target.value })} /></Field>
            </div>
            <select className="input" value={r.milestone_id} onChange={(e) => setR({ ...r, milestone_id: e.target.value })} aria-label="Apply to milestone"><option value="">Apply to earliest unpaid milestone</option>{l.milestones.map((x) => <option key={x.id} value={x.id}>{x.label} · {inr(x.amount_inr)}</option>)}</select>
            <div className="flex flex-wrap gap-4 text-[12px]">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.verified} onChange={(e) => setR({ ...r, verified: e.target.checked })} /> Verified against bank statement</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.is_test} onChange={(e) => setR({ ...r, is_test: e.target.checked })} /> Test / demo receipt (excluded from totals)</label>
            </div>
            <button className="btn-primary justify-self-start">Record receipt</button>
          </form>
          <p className="mt-1 text-[11px] text-slate-400">Only verified, non-test receipts count as cash received. The AI analyst cannot record receipts.</p>
        </div>
      </div>
    </Drawer>
  );
}

export default function CashPage() {
  const { data } = useDash(); const mutate = useMutate();
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  if (!data) return <Loading />;
  const c = data.snapshot.cash;
  const lines = c.lines.filter((l) => !filter || l.status === filter).sort((a, b) => b.outstanding_inr - a.outstanding_inr);
  const unscheduled = c.lines.filter((l) => l.status === "no_schedule");
  const fc = c.forecast;
  const goal = data.snapshot.targets?.cash.goal;
  return (
    <div className="space-y-5">
      <PageHeader title="Cash Control Tower" subtitle="From sponsor commitment to verified cash. Confirmed value is a promise; only verified, non-test receipts are cash. In-kind is tracked separately and never counted as cash."
        actions={unscheduled.length > 0 && <button className="btn-teal" onClick={async () => { for (const l of unscheduled) await mutate("POST", "cash/schedule", { opportunity_id: l.opportunity_id }, `Schedule generated for ${l.brand_name}`); }}>Generate schedules for {unscheduled.length} unscheduled deals</button>} />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Confirmed cash-type" value={inr(c.confirmed_cash_inr, true)} sub={`In-kind (not cash): ${inr(c.confirmed_in_kind_inr, true)}`} />
        <Stat label="Scheduled / invoiced" value={`${inr(c.scheduled_inr, true)}`} sub={`Invoiced ${inr(c.invoiced_inr, true)}`} tone={c.unscheduled_confirmed_inr > 0 ? "warn" : "good"} />
        <Stat label="Due before festival" value={inr(c.due_before_festival_inr, true)} sub={`Due by clock: ${inr(c.due_by_asof_inr, true)}`} />
        <Stat label="Verified received" value={inr(c.received_verified_inr, true)} tone={c.received_verified_inr ? "good" : "bad"} sub={<>Unverified {inr(c.received_unverified_inr, true)} · test {inr(c.test_receipts_inr, true)} (excluded)</>} tag={<LabelTag kind={c.historical_receipts_available ? "CALCULATED" : "UNKNOWN"} />} />
        <Stat label="Overdue" value={inr(c.overdue_inr, true)} tone={c.overdue_inr ? "bad" : "good"} sub={`Outstanding ${inr(c.outstanding_inr, true)}`} />
        <Stat label="Forecast pre-festival" value={inr(fc.total_pre_festival_inr, true)} tag={<LabelTag kind="CALCULATED" />} sub={goal ? `Goal ${inr(goal, true)} · gap ${inr(goal - fc.total_pre_festival_inr, true)}` : ""} />
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Weekly schedule: due vs verified received" subtitle="Weeks start Monday (IST)">
          {c.weekly.length ? (
            <div className="h-60"><ResponsiveContainer><BarChart data={c.weekly} margin={{ top: 8, right: 8, left: 8 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#eef2f6" /><XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => inr(v, true)} axisLine={false} tickLine={false} width={64} />
              <Tooltip formatter={(v: number, n) => [inr(v), n]} cursor={{ fill: "#f1f5f9" }} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <RBar dataKey="due_inr" name="Scheduled due" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} /><RBar dataKey="received_inr" name="Verified received" fill="#0d9488" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart></ResponsiveContainer></div>
          ) : <p className="py-10 text-center text-[13px] text-slate-500">No payment milestones yet — generate schedules to see the weekly cash plan.</p>}
        </Card>
        <Card className="xl:col-span-2" title="Pre-festival forecast bridge" subtitle={fc.label}>
          <ul className="space-y-2 text-[13px]">
            <li className="flex justify-between"><span>Verified received <LabelTag kind="CALCULATED" /></span><b className="num">{inr(fc.received_inr)}</b></li>
            <li className="flex justify-between"><span>+ Unpaid confirmed × {fc.collection_probability} <LabelTag kind="ASSUMPTION" /></span><b className="num">{inr(fc.expected_from_confirmed_inr)}</b></li>
            <li className="flex justify-between"><span>+ Open cash pipeline × P(confirm) × {fc.collection_probability} × time {fc.time_factor}</span><b className="num">{inr(fc.expected_from_pipeline_inr)}</b></li>
            <li className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>= Forecast before festival</span><span className="num">{inr(fc.total_pre_festival_inr)}</span></li>
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">P(confirm) comes from closed deals in the live data by stage and channel group (Laplace-smoothed). The time factor drops to 0 within 2 days of the festival. Change the collection probability under Data &amp; Assumptions.</p>
        </Card>
      </div>

      <Card title="Sponsor-wise cash exposure" bodyClass="p-0" action={<select className="input py-1" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Status filter"><option value="">All statuses</option>{["no_schedule", "scheduled", "due_soon", "overdue", "paid"].map((s) => <option key={s} value={s}>{s}</option>)}</select>}>
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Sponsor</th><th>Owner</th><th>Confirmed cash</th><th>Scheduled</th><th>Received</th><th>Outstanding</th><th>Overdue</th><th>Next due</th><th>Status</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.opportunity_id} className="cursor-pointer" onClick={() => setSel(l.opportunity_id)}>
              <td><p className="font-medium text-slate-900">{l.brand_name}</p><p className="text-[11px] text-slate-400">{l.opportunity_id}</p></td><td>{l.owner_name ?? "—"}</td>
              <td className="num">{inr(l.confirmed_cash_inr)}</td><td className="num">{inr(l.scheduled_inr)}</td><td className="num text-emerald-700">{inr(l.received_verified_inr)}</td><td className="num font-medium">{inr(l.outstanding_inr)}</td>
              <td className={`num ${l.overdue_inr ? "font-semibold text-rose-600" : ""}`}>{inr(l.overdue_inr)}</td><td>{l.next_due_at ? `${dt(l.next_due_at)} · ${inr(l.next_due_inr, true)}` : "—"}</td><td><CashTag status={l.status} /></td>
            </tr>))}</tbody></table></div>
        {c.orphan_receipts.length > 0 && <p className="px-5 py-2 text-[12px] text-amber-700">⚠ {c.orphan_receipts.length} verified receipt(s) belong to opportunities that are no longer confirmed cash deals. Review them; they are not hidden.</p>}
      </Card>
      {(() => { const l = c.lines.find((x) => x.opportunity_id === sel); return l ? <LineDrawer key={l.opportunity_id} l={l} onClose={() => setSel(null)} /> : null; })()}
    </div>
  );
}

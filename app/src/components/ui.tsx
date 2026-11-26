"use client";
import { useEffect, type ReactNode } from "react";

export const inr = (n: number | null | undefined, compact = false) => {
  if (n == null || Number.isNaN(n)) return "—";
  if (compact) {
    const a = Math.abs(n);
    if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
    if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`;
  }
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
export const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const IST_OFFSET = 5.5 * 3600_000;
export const dt = (t: number | null | undefined, withTime = false) => {
  if (t == null || Number.isNaN(t)) return "—";
  const s = new Date(t + IST_OFFSET).toISOString();
  const d = new Date(s.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return withTime ? `${d} ${s.slice(11, 16)}` : d;
};
/** datetime-local value (IST wall clock) <-> ISO with +05:30 */
export const toLocalInput = (t: number) => new Date(t + IST_OFFSET).toISOString().slice(0, 16);
export const fromLocalInput = (v: string) => `${v.length === 16 ? v + ":00" : v}+05:30`;
export const STAGE_LABEL: Record<string, string> = { prospecting: "Prospecting", contacted: "Contacted", proposal_sent: "Proposal sent", negotiating: "Negotiating", partner_confirmed: "Confirmed", lost: "Lost", withdrawn: "Withdrawn" };

type Tone = "slate" | "teal" | "green" | "amber" | "red" | "indigo" | "navy";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-50 text-slate-600 ring-slate-200", teal: "bg-teal-50 text-teal-700 ring-teal-200", green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200", red: "bg-rose-50 text-rose-700 ring-rose-200", indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200", navy: "bg-navy-900 text-white ring-navy-900",
};
export const Tag = ({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) => <span title={title} className={`tag ${TONES[tone]}`}>{children}</span>;

export const stageTone = (s: string): Tone => (s === "partner_confirmed" ? "green" : s === "lost" || s === "withdrawn" ? "red" : s === "negotiating" ? "indigo" : s === "proposal_sent" ? "teal" : "slate");
export const StageTag = ({ stage }: { stage: string }) => <Tag tone={stageTone(stage)}>{STAGE_LABEL[stage] ?? stage}</Tag>;
const SIGNAL: Record<string, [Tone, string]> = { scale: ["green", "▲ Scale"], change: ["amber", "◆ Change"], stop: ["red", "■ Stop"], insufficient_data: ["slate", "… Not enough data"] };
export const SignalTag = ({ signal }: { signal: string }) => <Tag tone={SIGNAL[signal]?.[0] ?? "slate"}>{SIGNAL[signal]?.[1] ?? signal}</Tag>;
const CASH: Record<string, [Tone, string]> = { no_schedule: ["red", "No schedule"], scheduled: ["slate", "Scheduled"], due_soon: ["amber", "Due ≤7d"], overdue: ["red", "Overdue"], paid: ["green", "Paid"], over_collected: ["amber", "Over-collected"] };
export const CashTag = ({ status }: { status: string }) => <Tag tone={CASH[status]?.[0] ?? "slate"}>{CASH[status]?.[1] ?? status}</Tag>;
export const LabelTag = ({ kind }: { kind: "SOURCE" | "CALCULATED" | "ASSUMPTION" | "SIMULATION" | "UNKNOWN" }) => (
  <Tag tone={kind === "SOURCE" ? "navy" : kind === "CALCULATED" ? "teal" : kind === "ASSUMPTION" ? "amber" : kind === "SIMULATION" ? "indigo" : "red"}>{kind}</Tag>
);

export function Card({ title, action, children, className = "", bodyClass = "card-b", subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <div><h2 className="card-t">{title}</h2>{subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}</div>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default", tag }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" | "bad"; tag?: ReactNode }) {
  const bar = tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-rose-500" : "bg-brand";
  return (
    <div className="card relative overflow-hidden p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {tag}
      </div>
      <p className="num mt-1.5 text-[24px] font-semibold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-[12px] leading-snug text-slate-500">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-[20px] font-semibold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 max-w-3xl text-[13px] text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-950/30" onClick={onClose} />
      <div className={`relative flex h-full w-full ${width} flex-col bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="text-[15px] font-semibold text-slate-900">{title}</div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-950/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5"><h3 className="text-[15px] font-semibold">{title}</h3><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}</label>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-500">{children}</div>;

export function Bar({ value, max, tone = "teal" }: { value: number; max: number; tone?: "teal" | "indigo" | "amber" | "red" }) {
  const c = tone === "indigo" ? "bg-series-a" : tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-rose-500" : "bg-brand";
  return <div className="h-2 w-full rounded-full bg-slate-100"><div className={`h-2 rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))}%` }} /></div>;
}

export const Loading = () => <div className="grid h-64 place-items-center text-[13px] text-slate-500">Loading live data…</div>;

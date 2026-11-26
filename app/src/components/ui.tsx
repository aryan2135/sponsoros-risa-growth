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
const TONES: Record<Tone, [string, string]> = {
  slate: ["bg-paper text-ink-2 ring-line-strong", "bg-muted"],
  teal: ["bg-brand-soft text-teal-800 ring-teal-200", "bg-brand"],
  green: ["bg-emerald-50 text-emerald-800 ring-emerald-200", "bg-emerald-500"],
  amber: ["bg-amber-50 text-amber-800 ring-amber-200", "bg-amber-500"],
  red: ["bg-rose-50 text-rose-700 ring-rose-200", "bg-rose-500"],
  indigo: ["bg-indigo-50 text-indigo-700 ring-indigo-200", "bg-indigo-500"],
  navy: ["bg-ink text-white ring-ink", "bg-brand-bright"],
};
export const Tag = ({ tone = "slate", children, title, dot = true }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) => (
  <span title={title} className={`tag ${TONES[tone][0]}`}>{dot && <span className={`h-1.5 w-1.5 rounded-full ${TONES[tone][1]}`} aria-hidden />}{children}</span>
);

export const stageTone = (s: string): Tone => (s === "partner_confirmed" ? "green" : s === "lost" || s === "withdrawn" ? "red" : s === "negotiating" ? "indigo" : s === "proposal_sent" ? "teal" : "slate");
export const StageTag = ({ stage }: { stage: string }) => <Tag tone={stageTone(stage)}>{STAGE_LABEL[stage] ?? stage}</Tag>;
const SIGNAL: Record<string, [Tone, string]> = { scale: ["green", "▲ Scale"], change: ["amber", "◆ Change"], stop: ["red", "■ Stop"], insufficient_data: ["slate", "… Not enough data"] };
export const SignalTag = ({ signal }: { signal: string }) => <Tag dot={false} tone={SIGNAL[signal]?.[0] ?? "slate"}>{SIGNAL[signal]?.[1] ?? signal}</Tag>;
const CASH: Record<string, [Tone, string]> = { no_schedule: ["red", "No schedule"], scheduled: ["slate", "Scheduled"], due_soon: ["amber", "Due ≤7d"], overdue: ["red", "Overdue"], paid: ["green", "Paid"], over_collected: ["amber", "Over-collected"] };
export const CashTag = ({ status }: { status: string }) => <Tag tone={CASH[status]?.[0] ?? "slate"}>{CASH[status]?.[1] ?? status}</Tag>;
export const LabelTag = ({ kind }: { kind: "SOURCE" | "CALCULATED" | "ASSUMPTION" | "SIMULATION" | "UNKNOWN" }) => (
  <span className={`whitespace-nowrap rounded px-1.5 py-[1px] font-mono text-[9px] font-semibold tracking-wider ${kind === "SOURCE" ? "bg-ink text-white" : kind === "CALCULATED" ? "bg-brand-soft text-teal-800" : kind === "ASSUMPTION" ? "bg-amber-100 text-amber-800" : kind === "SIMULATION" ? "bg-indigo-100 text-indigo-700" : "bg-rose-100 text-rose-700"}`}>{kind}</span>
);

export function Card({ title, action, children, className = "", bodyClass = "card-b", subtitle, kicker }: { title?: ReactNode; subtitle?: ReactNode; kicker?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <div className="min-w-0">
            {kicker && <p className="kicker mb-0.5">{kicker}</p>}
            <h2 className="card-t">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default", tag }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" | "bad"; tag?: ReactNode }) {
  const dot = tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-rose-500" : "bg-brand";
  return (
    <div className="card flex min-w-0 flex-col px-4 py-3">
      <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted" title={label}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />{label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="display num whitespace-nowrap text-[30px] leading-none text-ink">{value}</p>
        {tag && <span className="mb-0.5">{tag}</span>}
      </div>
      {sub && <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: string; subtitle?: ReactNode; actions?: ReactNode; kicker?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker && <p className="kicker mb-1">{kicker}</p>}
        <h1 className="display text-[34px] leading-[1.05] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
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
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative flex h-full w-full ${width} flex-col border-l border-line bg-paper shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <div className="text-[15px] font-semibold text-ink">{title}</div>
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
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h3 className="display text-[22px]">{title}</h3><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}</label>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-4 py-5 text-center text-[12.5px] text-muted">{children}</div>;

export function Bar({ value, max, tone = "teal" }: { value: number; max: number; tone?: "teal" | "indigo" | "amber" | "red" }) {
  const c = tone === "indigo" ? "bg-series-a" : tone === "amber" ? "bg-signal" : tone === "red" ? "bg-rose-500" : "bg-brand";
  return <div className="h-1.5 w-full rounded-full bg-paper-2"><div className={`h-1.5 rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))}%` }} /></div>;
}

export const Loading = () => (
  <div className="space-y-3" aria-busy="true">
    <div className="h-9 w-64 animate-pulse rounded-lg bg-paper-2" />
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-[14px] bg-paper-2" />)}</div>
    <div className="h-64 animate-pulse rounded-[14px] bg-paper-2" />
    <p className="text-[12px] text-muted">Loading live data…</p>
  </div>
);

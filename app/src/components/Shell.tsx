"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useDash, useMutate } from "@/lib/client";
import Chat from "./Chat";
import { Drawer, dt, toLocalInput, fromLocalInput, inr } from "./ui";

type NavItem = { href: string; label: string; icon: ReactNode };
const I = (d: string) => <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Operate", items: [
    { href: "/", label: "Overview", icon: I("M3 12h4l3-8 4 16 3-8h4") },
    { href: "/cash", label: "Cash Control Tower", icon: I("M4 7h16M4 12h16M4 17h10M17 15l2 2 3-3") },
    { href: "/pipeline", label: "Opportunity Pipeline", icon: I("M3 5h18l-7 8v6l-4-2v-4z") },
    { href: "/sponsors", label: "Sponsor CRM", icon: I("M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8") },
    { href: "/tasks", label: "Tasks & Decisions", icon: I("M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9") },
  ] },
  { title: "Plan", items: [
    { href: "/campaigns", label: "Campaigns & Playbook", icon: I("M3 11l18-8-8 18-2-8z") },
    { href: "/simulator", label: "Scenario Simulator", icon: I("M4 20V10M10 20V4M16 20v-7M22 20H2") },
    { href: "/analyst", label: "AI Growth Analyst", icon: I("M12 3l1.9 4.6L19 9.5l-4 3.4 1.2 5.1L12 15.4 7.8 18l1.2-5.1-4-3.4 5.1-1.9z") },
  ] },
  { title: "System", items: [{ href: "/data", label: "Data & Assumptions", icon: I("M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6") }] },
];

const PRESETS: [string, string][] = [["15 Mar", "2025-03-15T23:59:59+05:30"], ["11 Apr", "2025-04-11T23:59:59+05:30"], ["20 Apr", "2025-04-20T23:59:59+05:30"]];
const PRESET_TITLE: Record<string, string> = { "15 Mar": "Mid-campaign · 15 Mar 2025", "11 Apr": "Pre-festival cutoff · 11 Apr 2025", "20 Apr": "History end · 20 Apr 2025" };

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#2dd4bf" />
      <path d="M9 21.5c1.6 1.3 3.6 2 6 2 3.5 0 6-1.7 6-4.4 0-2.4-1.8-3.4-5.4-4.1-2.7-.5-3.6-.9-3.6-1.9 0-1 1-1.6 2.7-1.6 1.6 0 3 .5 4.2 1.4" fill="none" stroke="#0f1521" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="23.5" cy="8.5" r="2.2" fill="#0f1521" />
    </svg>
  );
}

function CashPulse() {
  const { data } = useDash();
  if (!data) return null;
  const c = data.snapshot.cash;
  const goal = data.snapshot.targets?.cash.goal ?? c.confirmed_cash_inr;
  const max = Math.max(goal, c.confirmed_cash_inr, 1);
  const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400">Cash pulse</p>
      <p className="display mt-1 text-[22px] leading-none text-white">{inr(c.received_verified_inr, true)}<span className="ml-1 font-sans text-[11px] text-slate-400">received</span></p>
      <div className="relative mt-2.5 h-1.5 rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: w(c.confirmed_cash_inr) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand-bright" style={{ width: w(c.received_verified_inr) }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-slate-400">
        <span>{inr(c.confirmed_cash_inr, true)} committed</span><span>goal {inr(goal, true)}</span>
      </div>
    </div>
  );
}

function Clock() {
  const { data } = useDash();
  const mutate = useMutate();
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(false);
  if (!data) return <div className="h-8 w-80 animate-pulse rounded-lg bg-paper-2" />;
  const cur = String(data.as_of_setting);
  const days = data.snapshot.days_to_festival;
  const presetKey = PRESETS.find((p) => p[1] === cur)?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="kicker hidden sm:inline">As of</span>
      <div className="flex items-center rounded-[10px] border border-line-strong bg-white p-0.5" role="group" aria-label="Operating clock presets">
        {PRESETS.map(([k, v]) => (
          <button key={k} title={PRESET_TITLE[k]} onClick={() => mutate("PATCH", "settings", { as_of: v }, "Operating clock moved — all analytics recomputed")}
            className={`rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition ${presetKey === k ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`}>{k}</button>
        ))}
        <button onClick={() => setEditing(!editing)} className={`rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition ${!presetKey ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`} title="Custom date and time">
          {presetKey ? "Custom" : dt(data.as_of, true)}
        </button>
      </div>
      {editing && (
        <span className="flex items-center gap-1">
          <input type="datetime-local" className="input py-1" value={custom || toLocalInput(data.as_of)} onChange={(e) => setCustom(e.target.value)} aria-label="Custom clock" />
          <button className="btn py-1" onClick={() => { if (custom) mutate("PATCH", "settings", { as_of: fromLocalInput(custom) }, "Operating clock moved"); setEditing(false); }}>Set</button>
        </span>
      )}
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${days < 0 ? "bg-paper-2 text-ink-2" : days < 7 ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-brand-soft text-teal-800 ring-1 ring-teal-200"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${days < 0 ? "bg-muted" : days < 7 ? "animate-pulse bg-rose-500" : "bg-brand"}`} />
        {days < 0 ? `Festival started ${Math.abs(days).toFixed(1)}d ago` : `T−${days.toFixed(1)}d to festival`}
      </span>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { error, data } = useDash();
  const [chat, setChat] = useState(false);
  const [nav, setNav] = useState(false);
  if (path === "/login") return <>{children}</>;
  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-40 flex h-screen w-[228px] shrink-0 flex-col bg-rail text-slate-300 transition-transform lg:sticky lg:top-0 lg:translate-x-0 ${nav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <Logo />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-white">Sponsor<span className="text-brand-bright">OS</span></div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-slate-500">revenue → cash</div>
          </div>
        </div>
        <nav className="flex-1 space-y-3 overflow-y-auto px-2.5 pb-3 pt-1">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="px-2 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500">{g.title}</p>
              {g.items.map(({ href, label, icon }) => {
                const active = href === "/" ? path === "/" : path.startsWith(href);
                return (
                  <Link key={href} href={href} onClick={() => setNav(false)}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition ${active ? "bg-white/[0.08] font-medium text-white" : "hover:bg-white/[0.04] hover:text-white"}`}>
                    {active && <span className="absolute -left-2.5 top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand-bright" aria-hidden />}
                    <span className={active ? "text-brand-bright" : "text-slate-500 group-hover:text-slate-300"}>{icon}</span>{label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="space-y-2.5 border-t border-white/[0.06] px-3 pb-3 pt-3">
          <CashPulse />
          <p className="px-1 font-mono text-[9.5px] leading-relaxed text-slate-500">
            {data?.event.event_name} · Bengaluru<br />src sha {data?.source?.sha256.slice(0, 10)}
          </p>
        </div>
      </aside>
      {nav && <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden" onClick={() => setNav(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/85 px-4 py-2 backdrop-blur-md lg:px-6">
          <div className="flex items-center gap-2"><button className="btn-ghost lg:hidden" onClick={() => setNav(true)} aria-label="Menu">☰</button><Clock /></div>
          <button className="btn-teal" onClick={() => setChat(true)}>✦ Ask the analyst</button>
        </header>
        <main className="canvas-grid px-4 pb-8 pt-5 lg:px-6">
          {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-rose-700">Could not load data: {error}</div>}
          {children}
        </main>
      </div>
      <Drawer open={chat} onClose={() => setChat(false)} title={<span className="flex items-center gap-2"><span className="text-brand">✦</span> AI Growth Analyst</span>} width="max-w-lg">
        <div className="h-[calc(100vh-96px)]"><Chat compact /></div>
      </Drawer>
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useDash, useMutate } from "@/lib/client";
import Chat from "./Chat";
import { Drawer, dt, toLocalInput, fromLocalInput } from "./ui";

const NAV = [
  ["/", "Overview", "◧"], ["/cash", "Cash Control Tower", "₹"], ["/pipeline", "Opportunity Pipeline", "▤"], ["/sponsors", "Sponsor CRM", "◎"],
  ["/campaigns", "Campaigns & Playbook", "◈"], ["/tasks", "Tasks & Decisions", "✓"], ["/simulator", "Scenario Simulator", "∿"], ["/analyst", "AI Growth Analyst", "✦"], ["/data", "Data & Assumptions", "⛁"],
] as const;

const PRESETS: [string, string][] = [["Mid-campaign · 15 Mar 2025", "2025-03-15T23:59:59+05:30"], ["Pre-festival cutoff · 11 Apr 2025", "2025-04-11T23:59:59+05:30"], ["History end · 20 Apr 2025", "2025-04-20T23:59:59+05:30"]];

function Clock() {
  const { data } = useDash();
  const mutate = useMutate();
  const [custom, setCustom] = useState("");
  if (!data) return null;
  const cur = String(data.as_of_setting);
  const days = data.snapshot.days_to_festival;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Operating clock</span>
      <select className="input py-1" value={PRESETS.some((p) => p[1] === cur) ? cur : "custom"} onChange={(e) => e.target.value !== "custom" && mutate("PATCH", "settings", { as_of: e.target.value }, "Operating clock moved — all analytics recomputed")} aria-label="Operating clock preset">
        {PRESETS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
        <option value="custom">Custom: {dt(data.as_of, true)}</option>
      </select>
      <input type="datetime-local" className="input py-1" value={custom || toLocalInput(data.as_of)} onChange={(e) => setCustom(e.target.value)} aria-label="Custom clock" />
      <button className="btn py-1" onClick={() => custom && mutate("PATCH", "settings", { as_of: fromLocalInput(custom) }, "Operating clock moved")}>Set</button>
      <span className={`rounded-md px-2 py-1 font-semibold ${days < 0 ? "bg-slate-100 text-slate-600" : days < 7 ? "bg-rose-50 text-rose-700" : "bg-teal-50 text-teal-700"}`}>
        {days < 0 ? `Festival started ${Math.abs(days).toFixed(1)}d ago` : `${days.toFixed(1)} days to festival`}
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
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-navy-900 text-slate-300 transition-transform lg:static lg:translate-x-0 ${nav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-5 pb-4 pt-5">
          <div className="text-[17px] font-semibold tracking-tight text-white">Sponsor<span className="text-teal-400">OS</span></div>
          <div className="mt-0.5 text-[11px] text-slate-400">Sponsorship revenue-to-cash OS</div>
        </div>
        <nav className="space-y-0.5 px-3">
          {NAV.map(([href, label, icon]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setNav(false)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition ${active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"}`}>
                <span className={`w-4 text-center ${active ? "text-teal-400" : "text-slate-500"}`}>{icon}</span>{label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-slate-400">
          {data?.event.event_name} · Bengaluru<br />Source: {data?.source?.file_name ?? "—"}<br />
          <span className="font-mono">sha {data?.source?.sha256.slice(0, 10)}</span>
        </div>
      </aside>
      {nav && <div className="fixed inset-0 z-30 bg-navy-950/30 lg:hidden" onClick={() => setNav(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3"><button className="btn-ghost lg:hidden" onClick={() => setNav(true)} aria-label="Menu">☰</button><Clock /></div>
          <button className="btn-teal" onClick={() => setChat(true)}>✦ Ask the analyst</button>
        </header>
        <main className="px-4 py-6 lg:px-8">
          {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">Could not load data: {error}</div>}
          {children}
        </main>
      </div>
      <Drawer open={chat} onClose={() => setChat(false)} title={<span>✦ AI Growth Analyst</span>} width="max-w-lg">
        <div className="h-[calc(100vh-110px)]"><Chat compact /></div>
      </Drawer>
    </div>
  );
}

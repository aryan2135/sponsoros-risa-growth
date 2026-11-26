"use client";
import { useEffect, useRef, useState } from "react";
import { api, useDash } from "@/lib/client";
import { Tag } from "./ui";

interface Proposal { recommendation: Record<string, unknown> & { issue: string; action: string; evidence: { summary: string }; diagnosis?: string; expected_impact?: string }; task: Record<string, unknown> & { title: string; owner_id: string | null; due_at: string; priority: string } }
interface Msg { role: "user" | "assistant"; content: string; provider?: string; tools?: { name: string; input: unknown; summary: string }[]; proposals?: Proposal[]; as_of?: string; grounding?: { checked: number; matched: number; unmatched: string[] } }

const SUGGESTIONS: [string, string][] = [
  ["Cash", "How much cash have we actually collected?"],
  ["Risk", "Which sponsors need immediate intervention?"],
  ["Campaigns", "Which campaigns have the best conversion?"],
  ["Pipeline", "Which opportunities are becoming stale?"],
  ["What-if", "What happens if the collection rate falls by 10 percentage points?"],
  ["Honesty", "What was the historical ROI of Brand Discovery Email?"],
];

function md(s: string) {
  // tiny, safe markdown: escape, then bold/italic/line structure
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/_(Deterministic analyst.+?)_/g, '<span class="text-muted">$1</span>')
    .split("\n").map((l) => (/^\s*#{1,4} /.test(l) ? `<h3>${l.replace(/^\s*#{1,4} /, "")}</h3>` : /^\s*[-•*] /.test(l) ? `<li>${l.replace(/^\s*[-•*] /, "")}</li>` : /^\s*-{3,}\s*$/.test(l) ? "" : l ? `<p>${l}</p>` : "")).join("")
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}

function ProposalCard({ p, onDone }: { p: Proposal; onDone: (s: string) => void }) {
  const { data, refresh, toast } = useDash();
  const [task, setTask] = useState(p.task);
  const [state, setState] = useState<"pending" | "saving" | "approved" | "rejected">("pending");
  const decide = async (decision: "approved" | "rejected") => {
    setState("saving");
    try {
      const r = await api<{ task_id: number | null; recommendation_id: number }>("POST", "recommendations/decide", { recommendation: p.recommendation, decision, task: decision === "approved" ? task : undefined, actor: "ai" });
      setState(decision);
      toast(decision === "approved" ? `Task #${r.task_id} created (recommendation #${r.recommendation_id})` : `Recommendation #${r.recommendation_id} recorded as rejected`);
      onDone(decision === "approved" ? `Task #${r.task_id} saved` : "Rejected");
      await refresh();
    } catch (e) { setState("pending"); toast((e as Error).message, "err"); }
  };
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[12px]">
      <div className="mb-2 flex items-center justify-between"><Tag tone="amber">Proposed task · not saved</Tag>{state === "approved" && <Tag tone="green">✓ Saved</Tag>}{state === "rejected" && <Tag tone="slate">Rejected</Tag>}</div>
      <p className="font-semibold text-ink">{p.recommendation.issue}</p>
      <p className="mt-1 text-ink-2"><b>Evidence:</b> {p.recommendation.evidence.summary}</p>
      {p.recommendation.expected_impact && <p className="mt-1 text-ink-2"><b>Expected impact:</b> {p.recommendation.expected_impact}</p>}
      {state === "pending" || state === "saving" ? (
        <div className="mt-2 grid gap-2">
          <input className="input w-full" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} aria-label="Task title" />
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={task.owner_id ?? ""} onChange={(e) => setTask({ ...task, owner_id: e.target.value || null })} aria-label="Owner">
              <option value="">Unassigned</option>{Object.entries(data?.team ?? {}).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <input className="input" type="date" value={task.due_at.slice(0, 10)} onChange={(e) => setTask({ ...task, due_at: new Date(e.target.value + "T18:00:00+05:30").toISOString() })} aria-label="Due date" />
            <select className="input" value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })} aria-label="Priority"><option>high</option><option>medium</option><option>low</option></select>
          </div>
          <div className="flex gap-2"><button className="btn-teal" disabled={state === "saving"} onClick={() => decide("approved")}>Confirm & create task</button><button className="btn" disabled={state === "saving"} onClick={() => decide("rejected")}>Reject</button></div>
        </div>
      ) : null}
    </div>
  );
}

export default function Chat({ compact = false }: { compact?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"auto" | "local">("auto");
  const [cid] = useState(() => `c-${Date.now()}`);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await api<{ text: string; provider: string; tools: Msg["tools"]; proposals: Proposal[]; as_of: string; grounding?: Msg["grounding"] }>("POST", "chat", { conversation_id: cid, mode, messages: next.map(({ role, content }) => ({ role, content })) });
      setMsgs([...next, { role: "assistant", content: r.text, provider: r.provider, tools: r.tools, proposals: r.proposals, as_of: r.as_of, grounding: r.grounding }]);
    } catch (e) { setMsgs([...next, { role: "assistant", content: `Error: ${(e as Error).message}` }]); } finally { setBusy(false); }
  };
  return (
    <div className="flex h-full flex-col">
      <div className={`flex-1 space-y-3 overflow-y-auto pr-1 ${!msgs.length ? "flex flex-col justify-center" : ""}`}>
        {!msgs.length && (
          <div className={`mx-auto w-full ${compact ? "" : "max-w-3xl"}`}>
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-[18px] text-brand-bright">✦</span>
              <div>
                <p className={`display leading-tight text-ink ${compact ? "text-[22px]" : "text-[28px]"}`}>Ask the ledger anything.</p>
                <p className="text-[12px] text-muted">Answers come from live data through audited tools. Drafted tasks are saved only when you confirm.</p>
              </div>
            </div>
            <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
              {SUGGESTIONS.map(([k, s]) => (
                <button key={s} onClick={() => send(s)} className="group rounded-xl border border-line bg-white px-3 py-2.5 text-left transition hover:-translate-y-px hover:border-brand hover:shadow-[0_6px_20px_-12px_rgba(13,148,136,0.6)]">
                  <span className="kicker group-hover:text-brand">{k}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink">{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-xl rounded-br-sm bg-navy-900 px-3 py-2 text-[13px] text-white">{m.content}</div>
            ) : (
              <div className="rounded-xl rounded-bl-sm border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                <div className="prose-chat" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                {m.grounding && m.grounding.checked > 0 && (
                  <p className={`mt-2 text-[11px] ${m.grounding.unmatched.length ? "text-amber-700" : "text-emerald-700"}`}>
                    {m.grounding.unmatched.length ? `⚠ ${m.grounding.matched}/${m.grounding.checked} ₹ figures traced to backend tool data. Not traced (model-derived, verify): ${m.grounding.unmatched.join(", ")}` : `✓ All ${m.grounding.checked} ₹ figures traced to backend tool data`}
                  </p>
                )}
                {m.proposals?.map((p, k) => <ProposalCard key={k} p={p} onDone={() => {}} />)}
                {!!m.tools?.length && (
                  <details className="mt-2 text-[11px] text-muted">
                    <summary className="cursor-pointer select-none">Data used: {m.tools.map((t) => t.name).join(", ")} · {m.provider}</summary>
                    <ul className="mt-1 space-y-1">{m.tools.map((t, k) => <li key={k} className="rounded bg-paper p-1.5 font-mono text-[10px] break-all"><b>{t.name}</b>({JSON.stringify(t.input)}) → {t.summary}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-[12px] text-muted">Analysing live data…</div>}
        <div ref={endRef} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about cash, deals, campaigns, risks, scenarios…" aria-label="Message" />
        <button className="btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <label className="flex items-center gap-1"><input type="checkbox" checked={mode === "local"} onChange={(e) => setMode(e.target.checked ? "local" : "auto")} /> Force deterministic analyst</label>
        {msgs.length > 0 && <button className="hover:text-ink-2" onClick={() => setMsgs([])}>New conversation</button>}
      </div>
    </div>
  );
}

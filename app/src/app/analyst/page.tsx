"use client";
import Chat from "@/components/Chat";
import { PageHeader, Card } from "@/components/ui";
import { useEffect, useState } from "react";
import { api, useDash } from "@/lib/client";

export default function Analyst() {
  const { data } = useDash();
  const [prov, setProv] = useState("…");
  useEffect(() => { api<{ ai_provider: string }>("GET", "health").then((h) => setProv(h.ai_provider === "anthropic" ? "Anthropic Claude (live LLM)" : "Deterministic analyst (no API key configured)")); }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="AI Growth Analyst" subtitle="Grounded in live SponsorOS data through a fixed set of backend tools (no SQL access). Figures are computed deterministically; the analyst interprets them, flags missing data, and drafts tasks you must confirm." />
      <div className="grid gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3" bodyClass="p-4 h-[calc(100vh-220px)] min-h-[520px]"><Chat /></Card>
        <Card title="How it works" bodyClass="p-4 text-[12px] leading-relaxed text-slate-600 space-y-2">
          <p><b>1. Query.</b> The model may call only approved tools: overview, funnel, campaign comparison, opportunity filters, entity lookup, cash position, readiness queue, threshold signals, initiative plan, scenario model, tasks, breakdowns, data-availability checks.</p>
          <p><b>2. Calculate.</b> Every number comes from the same engine as the dashboard, recomputed on each question, so edited data is reflected immediately.</p>
          <p><b>3. Be honest.</b> Receipts and spend are not in the source data, so it answers “unknown” instead of guessing.</p>
          <p><b>4. Act with consent.</b> <code>propose_task</code> returns a draft only. You review, edit and confirm; the backend validates and saves it and logs the decision.</p>
          <p className="rounded-md bg-slate-50 p-2">Provider: <b>{prov}</b>. Without an API key, a deterministic analyst runs the same tools with templated language, and its answers say so. Open “Data used” under any answer to see the exact tool calls.</p>
          <p className="text-slate-400">As of {data ? new Date(data.as_of + 19800000).toISOString().slice(0, 16).replace("T", " ") : "…"} IST</p>
        </Card>
      </div>
    </div>
  );
}

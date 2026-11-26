import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client";
import { buildCtx, runTool, TOOL_SCHEMAS } from "./tools";
import { localAnalyst } from "./local";

export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ToolTrace { name: string; input: unknown; summary: string }
export interface AnalystReply { text: string; provider: string; tools: ToolTrace[]; proposals: unknown[]; as_of: string }

export const SYSTEM_PROMPT = `You are the AI Growth Analyst inside SponsorOS, the sponsorship revenue-to-cash operating system for a college festival team.
Objective of the team: maximise sponsorship CASH actually collected before the festival starts.

Grounding rules (non-negotiable):
- Use ONLY numbers returned by your tools in this turn. Data can change between messages, so call tools again for every question about current performance; never reuse a figure from an earlier answer without re-checking it.
- Cite the as_of timestamp and record IDs (O..., A..., SC..., T..., task ids) behind important figures. State numerator/denominator for rates.
- Confirmed partnership value is a commitment, not cash. In-kind value is never cash. "Received" means verified, non-test receipts only.
- The original 2025 dataset has no receipts and no campaign spend: historical cash collected, CAC and ROI are UNKNOWN unless the tools show recorded data. Say so plainly; never estimate them to be helpful.
- Campaign attribution is observational; do not claim a campaign caused an outcome.
- Separate evidence (tool data) from assumptions (labelled [ASSUMPTION]) and from simulations (labelled [SIMULATION]).
- If the data cannot answer the question, say exactly what is missing (call check_data_availability) and what data would answer it.
- You cannot change data. To turn an insight into action, call propose_task with the issue, evidence, diagnosis and expected impact; tell the user to review and click Confirm. Never claim a task was created.
- Owners are team member IDs (e.g. T01 Riya Kapoor). Use get_entity to resolve names to IDs.

Style: lead with the direct answer, then a short "Evidence" list, then "Recommendation" (if asked or useful), then "Limits" when relevant. Be concise; use INR with Indian digit grouping (e.g. ₹20,00,000).`;

function summarise(result: unknown): string {
  const s = JSON.stringify(result);
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
}

export function providerName(): "anthropic" | "local" {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "local";
}

export async function askAnalyst(db: Db, history: ChatTurn[], opts: { forceLocal?: boolean } = {}): Promise<AnalystReply> {
  const ctx = await buildCtx(db);
  const asOf = new Date(ctx.asOf).toISOString();
  if (opts.forceLocal || providerName() === "local") return { ...(await localAnalyst(ctx, history)), as_of: asOf };

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({ role: t.role, content: t.content }));
  const tools: ToolTrace[] = [];
  const proposals: unknown[] = [];
  for (let step = 0; step < 8; step++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM_PROMPT,
        tools: TOOL_SCHEMAS as unknown as Anthropic.Beta.BetaTool[],
        messages,
      } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? "Anthropic API key rejected." : e instanceof Anthropic.RateLimitError ? "Anthropic rate limit hit." : e instanceof Anthropic.APIError ? `Anthropic API error ${e.status}.` : "Could not reach the Anthropic API.";
      const local = await localAnalyst(ctx, history);
      return { ...local, text: `⚠ ${msg} Falling back to the deterministic analyst.\n\n${local.text}`, as_of: asOf };
    }
    if (res.stop_reason === "refusal") return { text: "The model declined this request. Try rephrasing it as a question about the sponsorship data.", provider: `anthropic:${res.model}`, tools, proposals, as_of: asOf };
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "(no answer)", provider: `anthropic:${res.model}`, tools, proposals, as_of: asOf };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of calls) {
      const out = await runTool(ctx, c.name, (c.input ?? {}) as Record<string, unknown>);
      tools.push({ name: c.name, input: c.input, summary: summarise(out) });
      if (c.name === "propose_task" && (out as { ok?: boolean }).ok) proposals.push((out as { proposal: unknown }).proposal);
      results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out), is_error: Boolean((out as { error?: string }).error) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "I hit the tool-call limit for one question. Please narrow the question.", provider: `anthropic:${model}`, tools, proposals, as_of: asOf };
}

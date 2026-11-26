import "server-only";
/**
 * Google Gemini adapter (REST generateContent with function calling) for the AI Growth Analyst.
 * Same controlled tool layer and system prompt as the Anthropic path; the model never touches the DB directly.
 * Resilience: per-call timeout, one short-backoff retry on 500/503, then the next model in the chain;
 * 429 (quota) / 404 (retired model) / timeout move straight to the next model; an overall deadline caps user wait.
 */
import { runTool, TOOL_SCHEMAS, type Ctx } from "./tools";
import type { ChatTurn, ToolTrace } from "./analyst";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_MODELS = (process.env.GEMINI_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CALL_TIMEOUT_MS = () => Number(process.env.GEMINI_TIMEOUT_MS ?? 25_000);
const DEADLINE_MS = () => Number(process.env.GEMINI_DEADLINE_MS ?? 60_000);
const BACKOFF_MS = () => Number(process.env.GEMINI_BACKOFF_MS ?? 1_500);

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: unknown; thoughtSignature?: string; thought?: boolean };
type Content = { role: "user" | "model"; parts: Part[] };

/** Gemini accepts an OpenAPI subset: drop keys it rejects (additionalProperties). */
function clean(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(clean);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) if (k !== "additionalProperties") out[k] = clean(v);
    return out;
  }
  return schema;
}
const DECLS = TOOL_SCHEMAS.map((t) => ({ name: t.name, description: t.description, parameters: clean(t.input_schema) }));

export class ModelUnavailable extends Error { constructor(msg: string, public retrySame: boolean) { super(msg); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// circuit breaker: skip a model for a cool-down after it was overloaded / timed out (keeps answers fast)
const COOLDOWN_MS = () => Number(process.env.GEMINI_COOLDOWN_MS ?? 5 * 60_000);
const gstate = globalThis as unknown as { __gemCool?: Map<string, number> };
gstate.__gemCool ??= new Map();
const cooling = (m: string) => (gstate.__gemCool!.get(m) ?? 0) > Date.now();

async function call(model: string, body: unknown, deadline: number): Promise<{ parts: Part[]; finish?: string }> {
  const left = deadline - Date.now();
  if (left <= 0) throw new ModelUnavailable("deadline exceeded", false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(CALL_TIMEOUT_MS(), left));
  try {
    const r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": String(process.env.GEMINI_API_KEY) },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 500 || r.status === 503) throw new ModelUnavailable(`${model}: HTTP ${r.status}`, true);
    if (r.status === 429 || r.status === 404) throw new ModelUnavailable(`${model}: HTTP ${r.status}`, false);
    if (!r.ok) throw new Error(`${model}: HTTP ${r.status}`); // 400/401/403: config problem, do not echo provider text
    const cand = j.candidates?.[0];
    return { parts: cand?.content?.parts ?? [], finish: cand?.finishReason };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new ModelUnavailable(`${model}: timeout`, false);
    throw e;
  } finally { clearTimeout(timer); }
}

async function callWithRetry(model: string, body: unknown, deadline: number) {
  try { return await call(model, body, deadline); }
  catch (e) {
    if (e instanceof ModelUnavailable && e.retrySame && deadline - Date.now() > BACKOFF_MS() + 2000) { await sleep(BACKOFF_MS()); return call(model, body, deadline); }
    throw e;
  }
}

export interface GeminiReply { text: string; provider: string; tools: ToolTrace[]; proposals: unknown[]; toolOutputs: unknown[]; attempts: string[] }

export async function askGemini(ctx: Ctx, history: ChatTurn[], system: string): Promise<GeminiReply> {
  const attempts: string[] = [];
  const deadline = Date.now() + DEADLINE_MS();
  const ordered = [...GEMINI_MODELS.filter((m) => !cooling(m)), ...GEMINI_MODELS.filter(cooling)]; // cooled models only as last resort
  for (const model of ordered) {
    const contents: Content[] = history.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
    const tools: ToolTrace[] = [];
    const proposals: unknown[] = [];
    const toolOutputs: unknown[] = [];
    try {
      for (let step = 0; step < 8; step++) {
        const res = await callWithRetry(model, { systemInstruction: { parts: [{ text: system }] }, contents, tools: [{ functionDeclarations: DECLS }], generationConfig: { temperature: 0.2 } }, deadline);
        contents.push({ role: "model", parts: res.parts }); // verbatim: thought signatures must be echoed back
        const calls = res.parts.filter((p) => p.functionCall);
        if (!calls.length) {
          const text = res.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim();
          if (!text) throw new ModelUnavailable(`${model}: empty answer (${res.finish ?? "no finish reason"})`, false);
          attempts.push(`${model}: ok`);
          return { text, provider: `gemini:${model}`, tools, proposals, toolOutputs, attempts };
        }
        const responses: Part[] = [];
        for (const p of calls) {
          const { name, args = {}, id } = p.functionCall!;
          const out = await runTool(ctx, name, args);
          toolOutputs.push(out);
          tools.push({ name, input: args, summary: JSON.stringify(out).slice(0, 220) });
          if (name === "propose_task" && (out as { ok?: boolean }).ok) proposals.push((out as { proposal: unknown }).proposal);
          responses.push({ functionResponse: { name, ...(id ? { id } : {}), response: { result: out } } });
        }
        contents.push({ role: "user", parts: responses });
      }
      attempts.push(`${model}: tool-call limit`);
      return { text: "I hit the tool-call limit for one question. Please narrow the question.", provider: `gemini:${model}`, tools, proposals, toolOutputs, attempts };
    } catch (e) {
      attempts.push((e as Error).message);
      if (e instanceof ModelUnavailable) gstate.__gemCool!.set(model, Date.now() + COOLDOWN_MS());
      if (!(e instanceof ModelUnavailable)) break; // config/auth error: no point trying other models
      if (Date.now() >= deadline) break;
    }
  }
  const err = new Error(`Gemini unavailable (${attempts.join("; ")})`);
  (err as Error & { attempts?: string[] }).attempts = attempts;
  throw err;
}

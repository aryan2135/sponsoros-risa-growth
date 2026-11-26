import "server-only";
/**
 * Google Gemini adapter (REST, generateContent with function calling) for the AI Growth Analyst.
 * Same controlled tool layer and system prompt as the Anthropic path; the model never touches the DB directly.
 * Tries a chain of models (free-tier capacity varies) and reports which one answered.
 */
import { runTool, TOOL_SCHEMAS, type Ctx } from "./tools";
import type { ChatTurn, ToolTrace } from "./analyst";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_MODELS = (process.env.GEMINI_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest")
  .split(",").map((s) => s.trim()).filter(Boolean);

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

class RetryableError extends Error {}

async function call(model: string, body: unknown): Promise<{ parts: Part[]; finish?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.GEMINI_TIMEOUT_MS ?? 45000));
  try {
    const r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": String(process.env.GEMINI_API_KEY) },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 || r.status === 429 || r.status === 500 || r.status === 404) throw new RetryableError(`${model}: HTTP ${r.status} ${j?.error?.status ?? ""}`);
    if (!r.ok) throw new Error(`${model}: HTTP ${r.status} ${j?.error?.message ?? ""}`.slice(0, 300));
    const cand = j.candidates?.[0];
    return { parts: cand?.content?.parts ?? [], finish: cand?.finishReason };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new RetryableError(`${model}: timeout`);
    throw e;
  } finally { clearTimeout(timer); }
}

export async function askGemini(ctx: Ctx, history: ChatTurn[], system: string): Promise<{ text: string; provider: string; tools: ToolTrace[]; proposals: unknown[] }> {
  const errors: string[] = [];
  for (const model of GEMINI_MODELS) {
    const contents: Content[] = history.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
    const tools: ToolTrace[] = [];
    const proposals: unknown[] = [];
    try {
      for (let step = 0; step < 8; step++) {
        const res = await call(model, { systemInstruction: { parts: [{ text: system }] }, contents, tools: [{ functionDeclarations: DECLS }], generationConfig: { temperature: 0.2 } });
        // keep the model turn verbatim (thought signatures must be echoed back)
        contents.push({ role: "model", parts: res.parts });
        const calls = res.parts.filter((p) => p.functionCall);
        if (!calls.length) {
          const text = res.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim();
          if (!text) throw new RetryableError(`${model}: empty answer (${res.finish ?? "no finish reason"})`);
          return { text, provider: `gemini:${model}`, tools, proposals };
        }
        const responses: Part[] = [];
        for (const p of calls) {
          const { name, args = {}, id } = p.functionCall!;
          const out = await runTool(ctx, name, args);
          tools.push({ name, input: args, summary: JSON.stringify(out).slice(0, 220) });
          if (name === "propose_task" && (out as { ok?: boolean }).ok) proposals.push((out as { proposal: unknown }).proposal);
          responses.push({ functionResponse: { name, ...(id ? { id } : {}), response: { result: out } } });
        }
        contents.push({ role: "user", parts: responses });
      }
      return { text: "I hit the tool-call limit for one question. Please narrow the question.", provider: `gemini:${model}`, tools, proposals };
    } catch (e) {
      errors.push((e as Error).message);
      if (!(e instanceof RetryableError)) break;
    }
  }
  throw new Error(`Gemini unavailable (${errors.join("; ")})`);
}

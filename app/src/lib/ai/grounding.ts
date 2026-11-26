/**
 * Post-hoc grounding check for LLM answers: every INR figure in the answer text must trace to a number
 * returned by a backend tool in the same turn (allowing for the precision the figure is written in).
 * Unmatched figures are surfaced to the user rather than silently trusted.
 */
export interface Grounding { checked: number; matched: number; unmatched: string[] }

const UNITS: Record<string, number> = { l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, k: 1e3 };

export function extractInr(text: string): { raw: string; value: number; tolerance: number }[] {
  const out: { raw: string; value: number; tolerance: number }[] = [];
  const re = /(?:₹|rs\.?\s?|inr\s?)\s*(-?[\d,]+(?:\.\d+)?)\s*(lakhs?|lac|crores?|cr|l|k)?\b/gi;
  for (const m of text.matchAll(re)) {
    const digits = m[1].replace(/,/g, "");
    const n = Number(digits);
    if (!Number.isFinite(n)) continue;
    const unit = m[2] ? UNITS[m[2].toLowerCase()] ?? 1 : 1;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const step = unit * Math.pow(10, -decimals);
    out.push({ raw: m[0].trim(), value: Math.abs(n * unit), tolerance: Math.max(1, step / 2) });
  }
  return out;
}

function collectNumbers(v: unknown, acc: Set<number>) {
  if (typeof v === "number" && Number.isFinite(v)) acc.add(Math.abs(v));
  else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) acc.add(Math.abs(Number(v)));
  else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectNumbers(x, acc));
}

export function checkGrounding(text: string, toolOutputs: unknown[]): Grounding {
  const nums = new Set<number>();
  toolOutputs.forEach((o) => collectNumbers(o, nums));
  const all = [...nums];
  const figs = extractInr(text);
  const unmatched = figs.filter((f) => f.value !== 0 && !all.some((n) => Math.abs(n - f.value) <= f.tolerance)).map((f) => f.raw);
  return { checked: figs.length, matched: figs.length - unmatched.length, unmatched: [...new Set(unmatched)] };
}

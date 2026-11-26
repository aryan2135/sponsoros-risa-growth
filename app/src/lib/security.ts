/**
 * Demo access gate + basic abuse controls.
 * This is a SHARED-PASSWORD gate for a demo deployment. It is not multi-user authentication,
 * has no roles, and per-instance in-memory rate limits reset on restart.
 */
import crypto from "node:crypto";

export const SESSION_COOKIE = "sponsoros_auth";

/** Session token = HMAC(password, fixed label). Rotating APP_PASSWORD invalidates every existing session. */
export function sessionToken(password: string) {
  return crypto.createHmac("sha256", password).update("sponsoros-session-v1").digest("hex");
}
export function safeEqual(a: string, b: string) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
/** Password required? Yes if set; and fail closed on Render (or when REQUIRE_APP_PASSWORD=true) if it is missing. */
export function authMode(): "open" | "password" | "misconfigured" {
  if (process.env.APP_PASSWORD) return "password";
  // Public demo by default: no password => open. Opt back into fail-closed with REQUIRE_APP_PASSWORD=true.
  if (process.env.REQUIRE_APP_PASSWORD === "true") return "misconfigured";
  return "open";
}
export const resetAllowed = () => process.env.ALLOW_RESET === "true";

// ---------------------------------------------------------------- in-memory sliding-window rate limiter
type Bucket = number[];
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
g.__rl ??= new Map();
export const LIMITS = {
  login: { max: 10, windowMs: 15 * 60_000 },
  login_global: { max: 100, windowMs: 15 * 60_000 }, // backstop across all clients
  chat: { max: 20, windowMs: 60_000 },
  write: { max: 120, windowMs: 60_000 },
} as const;
/** Client address for rate limiting. Uses the LAST X-Forwarded-For hop (appended by the hosting proxy);
 *  earlier hops are client-controlled and would let an attacker rotate identities. */
export function clientIp(headers: Headers) {
  const xff = headers.get("x-forwarded-for");
  const hops = xff ? xff.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return hops.at(-1) ?? headers.get("x-real-ip")?.trim() ?? "local";
}
/** Returns seconds to wait if the limit is exceeded, else 0. */
export function rateLimit(kind: keyof typeof LIMITS, key: string): number {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();
  const id = `${kind}:${key}`;
  const b = (g.__rl!.get(id) ?? []).filter((t) => now - t < windowMs);
  if (b.length >= max) { g.__rl!.set(id, b); return Math.ceil((windowMs - (now - b[0])) / 1000); }
  b.push(now); g.__rl!.set(id, b);
  if (g.__rl!.size > 10_000) for (const [k, v] of g.__rl!) if (!v.length || now - v[v.length - 1] > 3_600_000) g.__rl!.delete(k);
  return 0;
}

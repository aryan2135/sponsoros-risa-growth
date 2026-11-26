import { NextResponse } from "next/server";
import { authMode, clientIp, rateLimit, safeEqual, sessionToken, SESSION_COOKIE } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const wait = rateLimit("login", clientIp(req.headers)) || rateLimit("login_global", "all");
  if (wait) return NextResponse.json({ error: `Too many attempts. Try again in ${wait}s.` }, { status: 429, headers: { "retry-after": String(wait) } });
  const mode = authMode();
  if (mode === "open") return NextResponse.json({ ok: true, note: "auth disabled" });
  if (mode === "misconfigured") return NextResponse.json({ error: "APP_PASSWORD not configured" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!safeEqual(password, process.env.APP_PASSWORD!)) return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(process.env.APP_PASSWORD!), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return res;
}

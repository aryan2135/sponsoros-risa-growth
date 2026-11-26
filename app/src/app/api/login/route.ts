import { NextResponse } from "next/server";
async function token(pw: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sponsoros:" + pw));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.json({ ok: true, note: "auth disabled" });
  if (password !== pw) return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("sponsoros_auth", await token(pw), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return res;
}

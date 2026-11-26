import { NextResponse, type NextRequest } from "next/server";

// Optional shared-password gate. Enabled only when APP_PASSWORD is set (recommended for public deployments).
async function token(pw: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sponsoros:" + pw));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login" || pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  if (req.cookies.get("sponsoros_auth")?.value === (await token(pw))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };

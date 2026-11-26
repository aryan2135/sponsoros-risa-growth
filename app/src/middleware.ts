import { NextResponse, type NextRequest } from "next/server";
import { authMode, safeEqual, sessionToken, SESSION_COOKIE } from "@/lib/security";

/**
 * Shared-password demo gate. Public: GET /api/health (Render health check), the login page and POST /api/login.
 * Everything else (all pages, every read and write API) requires the session cookie when APP_PASSWORD is set.
 * On Render (or REQUIRE_APP_PASSWORD=true) a missing APP_PASSWORD fails closed with 503.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  if (method === "GET" && pathname === "/api/health") return NextResponse.next();
  if (pathname === "/login" || (pathname === "/api/login" && method === "POST")) return NextResponse.next();
  if (pathname === "/favicon.ico") return NextResponse.next();

  const mode = authMode();
  if (mode === "open") return NextResponse.next();
  if (mode === "misconfigured")
    return NextResponse.json({ error: "Service not configured: APP_PASSWORD is required on this deployment" }, { status: 503 });

  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, sessionToken(process.env.APP_PASSWORD!))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image).*)"],
};

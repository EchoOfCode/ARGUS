import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "argus_session";

function isValidTokenStructure(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) return false;
  const now = Date.now();
  // Check 7 day max age and reject future timestamps
  if (now - timestamp > 7 * 86400 * 1000 || timestamp > now + 60000) {
    return false;
  }
  // randomBytes is 16 bytes = 32 hex chars, SHA-256 HMAC is 64 hex chars
  return parts[1].length === 32 && parts[2].length === 64;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public assets and Next internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/static") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasValidToken = Boolean(sessionToken && isValidTokenStructure(sessionToken));

  // 2. Allow login page and login API endpoint
  if (pathname === "/login" || pathname === "/api/auth/login") {
    if (hasValidToken && pathname === "/login") {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
    return NextResponse.next();
  }

  // 3. Enforce authentication on all other routes
  if (!hasValidToken) {
    // For API routes, return 401 Unauthorized JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized: owner login required" },
        { status: 401 }
      );
    }
    // For page routes, redirect to /login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  clearFailedAttempts,
  createSessionToken,
  recordFailedAttempt,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifyAccessKey,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  // Check rate limiter
  const { allowed, retryAfterSeconds } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Too many failed login attempts. Please wait ${retryAfterSeconds} seconds.`,
      },
      { status: 429 }
    );
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const candidateKey = body.key || "";
  if (!candidateKey) {
    return NextResponse.json(
      { error: "Access key is required" },
      { status: 400 }
    );
  }

  if (!verifyAccessKey(candidateKey)) {
    recordFailedAttempt(ip);
    return NextResponse.json(
      { error: "Invalid access key. Authentication failed." },
      { status: 401 }
    );
  }

  // Clear rate limits on successful authentication
  clearFailedAttempts(ip);

  // Issue session token
  const sessionToken = createSessionToken();

  const response = NextResponse.json({
    success: true,
    message: "Authenticated successfully",
  });

  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}

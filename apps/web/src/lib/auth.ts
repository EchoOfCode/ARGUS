import crypto from "crypto";

export const SESSION_COOKIE_NAME = "argus_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// In-memory rate limiting map: IP -> { attempts, resetAt }
const loginAttempts = new Map<string, { attempts: number; resetAt: number }>();

export function getExpectedWebKey(): string {
  const customKey = process.env.ARGUS_WEB_ACCESS_KEY?.trim();
  if (customKey) return customKey;
  const secret = process.env.ARGUS_SECRET?.trim();
  if (secret) return secret;
  return "";
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.attempts >= 5) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { attempts: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    record.attempts += 1;
  }
}

export function clearFailedAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export function createSessionToken(): string {
  const expectedKey = getExpectedWebKey();
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${randomBytes}`;
  const hmac = crypto.createHmac("sha256", expectedKey || "default_fallback_seed");
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token?: string | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [timestampStr, randomBytes, receivedSig] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiration (7 days)
  const now = Date.now();
  if (now - timestamp > SESSION_MAX_AGE_SECONDS * 1000 || timestamp > now + 60000) {
    return false;
  }

  const expectedKey = getExpectedWebKey();
  if (!expectedKey) return false;

  const payload = `${timestampStr}.${randomBytes}`;
  const hmac = crypto.createHmac("sha256", expectedKey);
  hmac.update(payload);
  const computedSig = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSig, "hex"),
      Buffer.from(computedSig, "hex")
    );
  } catch {
    return false;
  }
}

export function verifyAccessKey(candidateKey: string): boolean {
  const expectedKey = getExpectedWebKey();
  if (!expectedKey || !candidateKey) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidateKey.trim()),
      Buffer.from(expectedKey)
    );
  } catch {
    return false;
  }
}

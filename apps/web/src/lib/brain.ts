import { getExpectedWebKey } from "./auth";

const BRAIN_BASE_URL = process.env.BRAIN_URL || "http://127.0.0.1:8000";

export async function brainFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const secretKey = getExpectedWebKey();
  const headers = new Headers(options.headers || {});

  headers.set("X-Argus-Web-Key", secretKey);
  headers.set("X-Argus-Secret", secretKey);

  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const url = `${BRAIN_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...options,
    headers,
    cache: "no-store",
  });
}

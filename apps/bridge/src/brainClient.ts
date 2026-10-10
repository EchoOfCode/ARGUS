import axios from "axios";
import crypto from "crypto";
import FormData from "form-data";
import pino from "pino";
import { Config } from "./config.js";

const logger = pino({ name: "argus:brainClient" });

/**
 * Generate cryptographic HMAC-SHA256 headers with timestamp (ADR 0001).
 */
export function generateAuthHeaders(secret: string, payloadString: string): Record<string, string> {
  const ts = Date.now().toString();
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${ts}.${payloadString}`);
  const signature = "sha256=" + hmac.digest("hex");

  return {
    "X-Argus-Timestamp": ts,
    "X-Argus-Signature": signature,
    "X-Argus-Secret": secret, // legacy fallback
  };
}

/**
 * Call the AI Brain (FastAPI backend) with JSON payload.
 */
export async function callBrain(
  config: Config,
  endpoint: string,
  data: Record<string, unknown> = {},
  method: "GET" | "POST" = "POST"
): Promise<any> {
  const url = `${config.aiBrainUrl}${endpoint}`;
  const payloadString = method === "GET" ? "" : JSON.stringify(data);
  const authHeaders = generateAuthHeaders(config.argusSecret, payloadString);

  logger.debug({ url, endpoint, method }, "Calling AI Brain");

  try {
    const response = await axios({
      method,
      url,
      data: method === "POST" ? data : undefined,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      timeout: 60000,
    });

    return response.data;
  } catch (err: any) {
    if (err.response) {
      logger.error(
        {
          status: err.response.status,
          data: err.response.data,
          endpoint,
        },
        "AI Brain returned an error"
      );
    } else {
      logger.error({ message: err.message, endpoint }, "Failed to connect to AI Brain");
    }
    throw err;
  }
}

/**
 * Send multipart/form-data to AI Brain (e.g. for audio transcription).
 */
export async function callBrainMultipart(
  config: Config,
  endpoint: string,
  formData: FormData
): Promise<any> {
  const url = `${config.aiBrainUrl}${endpoint}`;
  const authHeaders = generateAuthHeaders(config.argusSecret, "");

  logger.debug({ url, endpoint }, "Calling AI Brain (multipart)");

  try {
    const response = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders(),
        ...authHeaders,
      },
      timeout: 30000,
    });

    return response.data;
  } catch (err: any) {
    if (err.response) {
      logger.error(
        {
          status: err.response.status,
          data: err.response.data,
          endpoint,
        },
        "AI Brain multipart returned an error"
      );
    } else {
      logger.error({ message: err.message, endpoint }, "Failed to connect to AI Brain (multipart)");
    }
    throw err;
  }
}

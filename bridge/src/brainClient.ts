import axios, { AxiosError } from "axios";
import pino from "pino";
import { Config } from "./config.js";

const logger = pino({ name: "argus:brain" });

/**
 * Generic caller for the AI Brain backend.
 * All endpoints require the X-Argus-Secret header.
 */
export async function callBrain(
  config: Config,
  endpoint: string,
  payload: Record<string, any>
): Promise<any> {
  const url = `${config.aiBrainUrl}${endpoint}`;

  try {
    logger.info({ url, payload_keys: Object.keys(payload) }, "Calling AI Brain");

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Argus-Secret": config.argusSecret,
      },
      timeout: 30000, // 30s timeout for LLM calls
    });

    logger.info({ url, status: response.status }, "AI Brain response received");
    return response.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      if (err.response) {
        logger.error(
          {
            url,
            status: err.response.status,
            data: err.response.data,
          },
          "AI Brain returned error"
        );

        // For 502 (Groq error), return null so caller can handle gracefully
        if (err.response.status === 502) {
          return null;
        }

        throw new Error(
          `AI Brain error ${err.response.status}: ${JSON.stringify(err.response.data)}`
        );
      }

      // Network error — brain is unreachable
      logger.error({ url, message: err.message }, "AI Brain unreachable");
      throw new Error(`AI Brain unreachable: ${err.message}`);
    }

    throw err;
  }
}

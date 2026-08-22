import axios from "axios";
import FormData from "form-data";
import pino from "pino";
import { Config } from "./config.js";

const logger = pino({ name: "argus:brainClient" });

/**
 * Call the AI Brain (FastAPI backend) with JSON payload.
 */
export async function callBrain(
  config: Config,
  endpoint: string,
  data: Record<string, unknown>
): Promise<any> {
  const url = `${config.aiBrainUrl}${endpoint}`;

  logger.debug({ url, endpoint }, "Calling AI Brain");

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        "X-Argus-Secret": config.argusSecret,
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

  logger.debug({ url, endpoint }, "Calling AI Brain (multipart)");

  try {
    const response = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders(),
        "X-Argus-Secret": config.argusSecret,
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

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from bridge root or repo root
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export interface Config {
  myJid: string;
  aiBrainUrl: string;
  argusSecret: string;
  listenMode: "all" | "allowlist";
  allowedJids: string[];
  sendDelayMs: number;
  authDir: string;
  dbPath: string;
  briefingHour: number;
  briefingMinute: number;
  enableDailyBriefing: boolean;
  dedicatedGroupName: string;
  enablePassiveAlerts: boolean;
  ownerName: string;
}

const FORBIDDEN_SECRET_PLACEHOLDERS = new Set([
  "change-me-generate-with-openssl-rand-hex-32",
  "your_32_byte_hex_secret_here",
  "your_generated_secret_here",
  "dummy_secret",
]);

export const configSchema = z.object({
  MY_JID: z.string().min(1, "MY_JID is required (e.g. 919876543210@s.whatsapp.net)"),
  AI_BRAIN_URL: z.string().default("http://127.0.0.1:8000"),
  ARGUS_SECRET: z
    .string()
    .min(1, "ARGUS_SECRET is required")
    .refine(
      (val: string) => !FORBIDDEN_SECRET_PLACEHOLDERS.has(val) && !val.startsWith("change-me"),
      { message: "ARGUS_SECRET cannot be an unconfigured placeholder. Generate a 32-byte secret with: openssl rand -hex 32" }
    )
    .refine(
      (val: string) => process.env.ARGUS_TEST_MODE === "1" || val.length >= 32,
      { message: "ARGUS_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32" }
    ),
  LISTEN_MODE: z.enum(["all", "allowlist"]).default("all"),
  ALLOWED_JIDS: z.string().optional().default(""),
  SEND_DELAY_MS: z.coerce.number().default(1500),
  BRIEFING_HOUR: z.coerce.number().default(8),
  BRIEFING_MINUTE: z.coerce.number().default(0),
  ENABLE_DAILY_BRIEFING: z.string().optional().default("true"),
  DEDICATED_GROUP_NAME: z.string().default("ARGUS"),
  ENABLE_PASSIVE_ALERTS: z.string().optional().default("false"),
  OWNER_NAME: z.string().default("User"),
  AUTH_DIR: z.string().optional(),
  DB_PATH: z.string().optional(),
});

export function loadConfig(envOverride?: Record<string, string | undefined>): Config {
  const env = envOverride || process.env;
  const parseResult = configSchema.safeParse(env);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`\n❌ [ARGUS BRIDGE CONFIG ERROR] Startup validation failed:\n${errorDetails}\n`);
    throw new Error(`Invalid bridge configuration:\n${errorDetails}`);
  }

  const data = parseResult.data;
  const authDir = data.AUTH_DIR ? path.resolve(data.AUTH_DIR) : path.resolve(__dirname, "../auth_info");
  const dbPath = data.DB_PATH ? path.resolve(data.DB_PATH) : path.resolve(__dirname, "../argus.db");

  return {
    myJid: data.MY_JID,
    aiBrainUrl: data.AI_BRAIN_URL,
    argusSecret: data.ARGUS_SECRET,
    listenMode: data.LISTEN_MODE,
    allowedJids: data.ALLOWED_JIDS ? data.ALLOWED_JIDS.split(",").map((j) => j.trim()).filter(Boolean) : [],
    sendDelayMs: data.SEND_DELAY_MS,
    authDir,
    dbPath,
    briefingHour: data.BRIEFING_HOUR,
    briefingMinute: data.BRIEFING_MINUTE,
    enableDailyBriefing: data.ENABLE_DAILY_BRIEFING !== "false",
    dedicatedGroupName: data.DEDICATED_GROUP_NAME,
    enablePassiveAlerts: data.ENABLE_PASSIVE_ALERTS === "true",
    ownerName: data.OWNER_NAME,
  };
}

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from bridge root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

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

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): Config {
  const myJid = requireEnv("MY_JID");
  const aiBrainUrl = process.env.AI_BRAIN_URL || "http://127.0.0.1:8000";
  const argusSecret = requireEnv("ARGUS_SECRET");
  const listenMode = (process.env.LISTEN_MODE || "all") as "all" | "allowlist";
  const allowedJids = process.env.ALLOWED_JIDS
    ? process.env.ALLOWED_JIDS.split(",").map((j) => j.trim())
    : [];
  const sendDelayMs = parseInt(process.env.SEND_DELAY_MS || "1500", 10);
  const authDir = path.resolve(__dirname, "../auth_info");
  const dbPath = path.resolve(__dirname, "../argus.db");
  const briefingHour = parseInt(process.env.BRIEFING_HOUR || "8", 10);
  const briefingMinute = parseInt(process.env.BRIEFING_MINUTE || "0", 10);
  const enableDailyBriefing = process.env.ENABLE_DAILY_BRIEFING !== "false";
  const dedicatedGroupName = process.env.DEDICATED_GROUP_NAME || "ARGUS";
  const enablePassiveAlerts = process.env.ENABLE_PASSIVE_ALERTS === "true"; // Default false
  const ownerName = process.env.OWNER_NAME || "User";

  return {
    myJid,
    aiBrainUrl,
    argusSecret,
    listenMode,
    allowedJids,
    sendDelayMs,
    authDir,
    dbPath,
    briefingHour,
    briefingMinute,
    enableDailyBriefing,
    dedicatedGroupName,
    enablePassiveAlerts,
    ownerName,
  };
}

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load dotenv from root Snezhok folder
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const DEFAULT_SESSION_SECRET = "a_very_long_and_warm_cozy_secret_phrase_change_me_please";
const DEFAULT_INITIAL_INVITE_CODE = "COZY_SNEZHOK";

function readRequiredSecret(name: string, fallback: string) {
  const value = process.env[name] || fallback;
  if (process.env.NODE_ENV === "production" && value === fallback) {
    throw new Error(`${name} must be changed before running in production.`);
  }
  return value;
}

function parseCsv(value?: string) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  HOST: process.env.HOST || "0.0.0.0",
  NODE_ENV: process.env.NODE_ENV || "development",
  SESSION_SECRET: readRequiredSecret("SESSION_SECRET", DEFAULT_SESSION_SECRET),
  INITIAL_INVITE_CODE: readRequiredSecret("INITIAL_INVITE_CODE", DEFAULT_INITIAL_INVITE_CODE),
  ALLOWED_ORIGINS: parseCsv(process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN),
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || "104857600", 10), // Default 100MB
  DATABASE_URL: process.env.DATABASE_URL || "file:./data/app.db",
  STUN_URLS: parseCsv(
    process.env.STUN_URLS ||
      "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302,stun:stun3.l.google.com:19302,stun:stun4.l.google.com:19302"
  ),
  USE_TURN: process.env.USE_TURN === "true",
  TURN_URL: process.env.TURN_URL || "",
  TURN_USERNAME: process.env.TURN_USERNAME || "",
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || "",
};

export function isAllowedOrigin(origin?: string) {
  if (config.NODE_ENV === "development") {
    return (
      !origin ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:")
    );
  }

  if (!origin) return true;
  return config.ALLOWED_ORIGINS.includes(origin);
}

export function getIceServers() {
  const servers: Array<{ urls: string; username?: string; credential?: string }> =
    config.STUN_URLS.map((urls) => ({ urls }));

  if (config.USE_TURN && config.TURN_URL) {
    servers.push({
      urls: config.TURN_URL,
      username: config.TURN_USERNAME,
      credential: config.TURN_CREDENTIAL,
    });
  }

  return servers;
}

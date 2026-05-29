import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load dotenv from root Snezhok folder
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const config = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  HOST: process.env.HOST || "0.0.0.0",
  NODE_ENV: process.env.NODE_ENV || "development",
  SESSION_SECRET: process.env.SESSION_SECRET || "a_very_long_and_warm_cozy_secret_phrase_change_me_please",
  INITIAL_INVITE_CODE: process.env.INITIAL_INVITE_CODE || "COZY_SNEZHOK",
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || "104857600", 10), // Default 100MB
  DATABASE_URL: process.env.DATABASE_URL || "file:./data/app.db",
  USE_TURN: process.env.USE_TURN === "true",
  TURN_URL: process.env.TURN_URL || "",
  TURN_USERNAME: process.env.TURN_USERNAME || "",
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || "",
};

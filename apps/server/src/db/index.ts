import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import fs from "fs";

// Resolve database path (usually data/app.db at project root)
const dbPath = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/^file:/, "")
  : "./data/app.db";

// Ensure data folder exists
const dbDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(path.resolve(dbPath));
// Enable WAL mode for performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

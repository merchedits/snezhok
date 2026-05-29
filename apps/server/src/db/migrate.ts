import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsFolder = path.resolve(__dirname, "../../drizzle");

console.log("Running migrations from:", migrationsFolder);

try {
  migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully!");
  process.exit(0);
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}

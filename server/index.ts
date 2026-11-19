import { join, resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db.ts";

const root = resolve(import.meta.dirname, "..");
const dataDir = process.env.DATA_DIR ?? join(root, "data");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const db = openDb(join(dataDir, "portal.db"));
const app = await buildApp({
  db,
  uploadDir: join(dataDir, "uploads"),
  webDir: join(root, "dist", "web"),
  timeZone: process.env.SCHOOL_TIMEZONE ?? "Asia/Kolkata",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  logger: process.env.NODE_ENV === "production",
});

const close = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ port, host });
console.log(`Student Results Portal on http://localhost:${port}`);

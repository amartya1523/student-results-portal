import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";
import { createImporter } from "./import/importer.ts";
import { HttpError } from "./routes/http.ts";
import { importRoutes } from "./routes/imports.ts";
import { studentRoutes } from "./routes/students.ts";

export interface AppOptions {
  db: Db;
  uploadDir: string;
  /** Built frontend to serve. Skipped when the folder does not exist (dev, tests). */
  webDir?: string;
  maxUploadBytes?: number;
  timeZone?: string;
  /** Override "today" (YYYY-MM-DD). Tests use this to keep age checks stable. */
  today?: () => string;
  logger?: boolean;
}

/** Today's date in the school's timezone, not the server's. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, disableRequestLogging: true, bodyLimit: 1024 * 1024 });
  const today = opts.today ?? (() => todayIn(opts.timeZone ?? "Asia/Kolkata"));
  const maxUploadBytes = opts.maxUploadBytes ?? 50 * 1024 * 1024;
  const importer = createImporter(opts.db, { today });

  await app.register(multipart);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { code?: string; statusCode?: number };
    if (e.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({ error: { code: "FILE_TOO_LARGE", message: "The file is too large." } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } });
  });

  app.get("/api/health", async () => ({ ok: true }));
  await app.register(importRoutes, { db: opts.db, importer, uploadDir: opts.uploadDir, maxUploadBytes, today });
  await app.register(studentRoutes, { db: opts.db, today });

  if (opts.webDir && existsSync(join(opts.webDir, "index.html"))) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    // Client-side routes (/import, /students/STU00042) all load the SPA.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "No such API endpoint." } });
      }
      return reply.type("text/html").sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "No such API endpoint." } }),
    );
  }

  return app;
}

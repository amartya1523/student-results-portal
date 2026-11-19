import type { FastifyInstance } from "fastify";
import { unlink } from "node:fs/promises";
import type { Db } from "../db.ts";
import type { Importer } from "../import/importer.ts";
import { REQUIRED_COLUMNS } from "../import/rules.ts";
import { saveUpload, UploadRejected } from "../uploads.ts";
import { HttpError, intParam } from "./http.ts";

interface ImportRow {
  id: number;
  file_name: string;
  file_size: number;
  file_hash: string;
  status: string;
  error_message: string | null;
  as_of_date: string;
  bytes_read: number;
  rows_read: number;
  accepted: number;
  rejected: number;
  warnings: number;
  inserted: number;
  updated: number;
  unchanged: number;
  summary: string;
  ignored_columns: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function toImport(r: ImportRow) {
  return {
    id: r.id,
    fileName: r.file_name,
    fileSize: r.file_size,
    status: r.status as "queued" | "processing" | "completed" | "failed",
    errorMessage: r.error_message,
    asOfDate: r.as_of_date,
    progress: r.file_size > 0 ? Math.min(1, r.bytes_read / r.file_size) : 0,
    rowsRead: r.rows_read,
    accepted: r.accepted,
    rejected: r.rejected,
    warnings: r.warnings,
    inserted: r.inserted,
    updated: r.updated,
    unchanged: r.unchanged,
    summary: JSON.parse(r.summary) as {
      byCode?: Record<string, number>;
      byField?: Record<string, number>;
      warningsByCode?: Record<string, number>;
    },
    ignoredColumns: JSON.parse(r.ignored_columns) as string[],
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export interface ImportRoutesOptions {
  db: Db;
  importer: Importer;
  uploadDir: string;
  maxUploadBytes: number;
  today: () => string;
}

export async function importRoutes(app: FastifyInstance, opts: ImportRoutesOptions) {
  const { db, importer } = opts;

  const getImport = (id: number) => {
    const row = db.prepare(`SELECT * FROM imports WHERE id = ?`).get(id) as ImportRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", `There is no import #${id}.`);
    return row;
  };

  app.post("/api/imports", async (req, reply) => {
    if (!req.isMultipart()) {
      throw new HttpError(400, "NO_FILE", "Send the CSV as multipart/form-data in a field called “file”.");
    }
    const part = await req.file({ limits: { fileSize: opts.maxUploadBytes, files: 1 } });
    if (!part) throw new HttpError(400, "NO_FILE", "No file was attached. Choose a CSV file and try again.");

    const name = part.filename || "upload.csv";
    if (!/\.(csv|txt)$/i.test(name)) {
      part.file.resume();
      throw new HttpError(
        415,
        "NOT_CSV",
        `“${name}” is not a CSV file. Export the results sheet as CSV (UTF-8) and upload that.`,
      );
    }

    let saved;
    try {
      saved = await saveUpload(part.file, opts.uploadDir);
    } catch (err) {
      if (err instanceof UploadRejected) {
        if (err.code === "FILE_TOO_LARGE") {
          throw new HttpError(
            413,
            "FILE_TOO_LARGE",
            `The file is larger than ${Math.round(opts.maxUploadBytes / 1024 / 1024)} MB. Split it into smaller files (for example one per grade) and upload them one by one.`,
          );
        }
        throw new HttpError(422, err.code, err.message);
      }
      throw err;
    }

    const force = (req.query as Record<string, string>).force === "1";
    if (!force) {
      const previous = db
        .prepare(`SELECT * FROM imports WHERE file_hash = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`)
        .get(saved.hash) as ImportRow | undefined;
      if (previous) {
        await unlink(saved.path).catch(() => undefined);
        return reply.code(409).send({
          error: {
            code: "DUPLICATE_FILE",
            message: `This exact file was already imported as import #${previous.id}. Importing it again will not change any student, but you can do it anyway.`,
          },
          previous: toImport(previous),
        });
      }
    }

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO imports (file_name, file_size, file_hash, status, as_of_date) VALUES (?, ?, ?, 'queued', ?)`,
      )
      .run(name.slice(0, 255), saved.size, saved.hash, opts.today());
    const id = Number(lastInsertRowid);

    // Fire and forget: the client polls GET /api/imports/:id for progress.
    void importer.enqueue({ importId: id, filePath: saved.path }).finally(() => unlink(saved.path).catch(() => undefined));

    return reply.code(202).send({ import: toImport(getImport(id)) });
  });

  app.get("/api/imports", async () => {
    const rows = db.prepare(`SELECT * FROM imports ORDER BY id DESC LIMIT 25`).all() as unknown as ImportRow[];
    return { imports: rows.map(toImport), requiredColumns: REQUIRED_COLUMNS };
  });

  app.get("/api/imports/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id, "import id");
    return { import: toImport(getImport(id)) };
  });

  app.get("/api/imports/:id/errors", async (req) => {
    const id = intParam((req.params as { id: string }).id, "import id");
    getImport(id);
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const code = q.code && /^[A-Z_]+$/.test(q.code) ? q.code : null;
    const severity = q.severity === "warning" ? "warning" : "error";

    const where = `WHERE import_id = ? AND severity = ?` + (code ? ` AND code = ?` : "");
    const args: (string | number)[] = code ? [id, severity, code] : [id, severity];
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM import_errors ${where}`).get(...args) as { n: number };
    const rows = db
      .prepare(`SELECT line, student_id, code, problems, raw FROM import_errors ${where} ORDER BY line LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as {
      line: number;
      student_id: string | null;
      code: string;
      problems: string;
      raw: string;
    }[];

    return {
      total: n,
      page,
      pageSize,
      errors: rows.map((r) => ({
        line: r.line,
        studentId: r.student_id,
        code: r.code,
        problems: JSON.parse(r.problems),
        raw: r.raw,
      })),
    };
  });

  /** Every rejected row with its reasons, ready to open in Excel and fix. */
  app.get("/api/imports/:id/errors.csv", async (req, reply) => {
    const id = intParam((req.params as { id: string }).id, "import id");
    const imp = getImport(id);
    const rows = db
      .prepare(
        `SELECT line, student_id, code, problems, raw FROM import_errors WHERE import_id = ? AND severity = 'error' ORDER BY line`,
      )
      .all(id) as { line: number; student_id: string | null; code: string; problems: string; raw: string }[];

    const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["line,student_id,error_codes,what_to_fix,original_row"];
    for (const r of rows) {
      const problems = JSON.parse(r.problems) as { code: string; message: string }[];
      lines.push(
        [
          String(r.line),
          esc(r.student_id ?? ""),
          esc([...new Set(problems.map((p) => p.code))].join(" ")),
          esc(problems.map((p) => p.message).join(" ")),
          esc(r.raw),
        ].join(","),
      );
    }
    const base = imp.file_name.replace(/\.(csv|txt)$/i, "").replace(/[^\w.-]+/g, "_");
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${base}-rejected-rows.csv"`)
      .send("﻿" + lines.join("\r\n") + "\r\n"); // BOM so Excel opens it as UTF-8
  });
}

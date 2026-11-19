import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { setImmediate as nextTick } from "node:timers/promises";
import { computeResult } from "../grading.ts";
import { fold, transaction, type Db } from "../db.ts";
import { FileEncodingError, readCsv } from "./csv-reader.ts";
import { SUBJECTS, type Problem } from "./rules.ts";
import {
  HeaderError,
  mapHeader,
  validateRow,
  type HeaderMap,
  type SeenIds,
  type StudentRow,
} from "./validate-row.ts";

/**
 * How an import runs
 *
 * 1. Read and validate the whole file, streaming, keeping accepted rows in
 *    memory and progress in the imports table (the UI polls it).
 * 2. Write everything in ONE transaction: accepted students, the error rows
 *    and the final counts.
 *
 * So a file is all-or-nothing. If the server dies halfway, or the file turns
 * out to be broken at line 4,000, nothing half-imported is left behind and
 * the admin can simply upload it again. Bad *rows* never block good rows;
 * only a bad *file* (wrong encoding, missing columns) stops an import.
 */

export interface ImportRequest {
  importId: number;
  filePath: string;
}

interface Rejected {
  line: number;
  studentId: string | null;
  problems: Problem[];
  raw: string;
}

interface Accepted {
  line: number;
  row: StudentRow;
  raw: string;
}

/** Imported, but worth a second look. Never blocks a row. */
interface Warning {
  line: number;
  studentId: string;
  code: "SHARED_EMAIL" | "NAME_CHANGED";
  message: string;
  raw: string;
}

export class FileProblem extends Error {}

const PROGRESS_EVERY_ROWS = 250;

export interface ImporterOptions {
  /** Today's date (YYYY-MM-DD) in the school's timezone. */
  today: () => string;
}

export function createImporter(db: Db, options: ImporterOptions) {
  // Imports run one at a time. Two admins uploading at once would otherwise
  // race on "which file's version of STU00042 wins".
  let queue: Promise<void> = Promise.resolve();

  function enqueue(job: ImportRequest): Promise<void> {
    const run = queue.then(() => runImport(job));
    queue = run.catch(() => undefined);
    return run;
  }

  async function runImport({ importId, filePath }: ImportRequest): Promise<void> {
    const today = options.today();
    db.prepare(
      `UPDATE imports SET status='processing', as_of_date=?, started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    ).run(today, importId);

    try {
      const { accepted, rejected, header, rowsRead } = await validateFile(importId, filePath, today);
      if (rowsRead === 0) {
        throw new FileProblem("The file has a header row but no student rows under it.");
      }
      save(importId, accepted, rejected, header, rowsRead);
    } catch (err) {
      const message =
        err instanceof FileProblem || err instanceof HeaderError || err instanceof FileEncodingError
          ? err.message
          : "Something went wrong on our side while reading this file. Nothing from it was saved. Please try again, and if it keeps happening send the file to support.";
      if (!(err instanceof FileProblem || err instanceof HeaderError || err instanceof FileEncodingError)) {
        console.error(`[import ${importId}] unexpected failure`, err);
      }
      db.prepare(
        `UPDATE imports SET status='failed', error_message=?, finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      ).run(message, importId);
    }
  }

  async function validateFile(importId: number, filePath: string, today: string) {
    const size = (await stat(filePath)).size;
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

    let header: HeaderMap | null = null;
    const seen: SeenIds = new Map();
    const accepted: Accepted[] = [];
    const rejected: Rejected[] = [];
    let rowsRead = 0;

    const progress = db.prepare(
      `UPDATE imports SET bytes_read=?, rows_read=?, accepted=?, rejected=? WHERE id=?`,
    );

    for await (const record of readCsv(stream)) {
      if (!header) {
        header = mapHeader(record.fields);
        continue;
      }
      const outcome = validateRow(record.fields, header, seen, today, record.line, record.unterminatedQuote);
      if (outcome.kind === "skip") continue;
      rowsRead++;
      if (outcome.kind === "accepted") accepted.push({ line: record.line, row: outcome.row, raw: record.raw });
      else
        rejected.push({
          line: record.line,
          studentId: outcome.studentId,
          problems: outcome.problems,
          raw: record.raw,
        });

      if (rowsRead % PROGRESS_EVERY_ROWS === 0) {
        progress.run(Math.min(stream.bytesRead, size), rowsRead, accepted.length, rejected.length, importId);
        // Let HTTP requests (like the progress poll) through.
        await nextTick();
      }
    }

    if (!header) throw new FileProblem("The file is empty.");
    return { accepted, rejected, header, rowsRead };
  }

  function save(importId: number, accepted: Accepted[], rejected: Rejected[], header: HeaderMap, rowsRead: number) {
    const byCode: Record<string, number> = {};
    const byField: Record<string, number> = {};
    for (const r of rejected) {
      const main = r.problems[0]!.code;
      byCode[main] = (byCode[main] ?? 0) + 1;
      for (const p of r.problems) {
        const k = p.field ?? "(whole row)";
        byField[k] = (byField[k] ?? 0) + 1;
      }
    }

    const warnings = sharedEmailWarnings(accepted);

    const existing = db.prepare(
      `SELECT import_id, full_name, email, date_of_birth, grade_level, section, maths, science, english, social_studies, second_language
         FROM students WHERE student_id = ?`,
    );
    const upsert = db.prepare(`
      INSERT INTO students (student_id, full_name, email, date_of_birth, grade_level, section,
        maths, science, english, social_studies, second_language,
        total, percentage, grade, passed, search_text, import_id, source_line)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(student_id) DO UPDATE SET
        full_name=excluded.full_name, email=excluded.email, date_of_birth=excluded.date_of_birth,
        grade_level=excluded.grade_level, section=excluded.section,
        maths=excluded.maths, science=excluded.science, english=excluded.english,
        social_studies=excluded.social_studies, second_language=excluded.second_language,
        total=excluded.total, percentage=excluded.percentage, grade=excluded.grade, passed=excluded.passed,
        search_text=excluded.search_text, import_id=excluded.import_id, source_line=excluded.source_line,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `);
    const insertError = db.prepare(
      `INSERT INTO import_errors (import_id, line, student_id, severity, code, problems, raw) VALUES (?,?,?,?,?,?,?)`,
    );

    transaction(db, () => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      for (const { line, row, raw } of accepted) {
        const before = existing.get(row.studentId) as Record<string, unknown> | undefined;
        if (!before) inserted++;
        else if (sameStudent(before, row)) unchanged++;
        else updated++;
        if (before && fold(String(before.full_name)) !== fold(row.fullName)) {
          warnings.push({
            line,
            studentId: row.studentId,
            code: "NAME_CHANGED",
            message: `${row.studentId} was “${before.full_name}” (import #${before.import_id}) and is now “${row.fullName}”. The record was updated; check the ID is not a typo for another student.`,
            raw,
          });
        }

        const result = computeResult(row.marks);
        upsert.run(
          row.studentId,
          row.fullName,
          row.email,
          row.dateOfBirth,
          row.gradeLevel,
          row.section,
          ...SUBJECTS.map((s) => row.marks[s]),
          result.total,
          result.percentage,
          result.grade,
          result.passed ? 1 : 0,
          fold(`${row.studentId} ${row.fullName} ${row.email}`),
          importId,
          line,
        );
      }
      for (const r of rejected) {
        insertError.run(importId, r.line, r.studentId, "error", r.problems[0]!.code, JSON.stringify(r.problems), r.raw);
      }
      const warningsByCode: Record<string, number> = {};
      for (const w of warnings) {
        warningsByCode[w.code] = (warningsByCode[w.code] ?? 0) + 1;
        insertError.run(
          importId,
          w.line,
          w.studentId,
          "warning",
          w.code,
          JSON.stringify([{ code: w.code, field: w.code === "SHARED_EMAIL" ? "email" : "full_name", message: w.message }]),
          w.raw,
        );
      }
      db.prepare(
        `UPDATE imports SET status='completed', rows_read=?, accepted=?, rejected=?, warnings=?, inserted=?, updated=?, unchanged=?,
           bytes_read=file_size, summary=?, ignored_columns=?, finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?`,
      ).run(
        rowsRead,
        accepted.length,
        rejected.length,
        warnings.length,
        inserted,
        updated,
        unchanged,
        JSON.stringify({ byCode, byField, warningsByCode }),
        JSON.stringify(header.ignored),
        importId,
      );
    });
  }

  return { enqueue };
}

/**
 * Two different students with the same email is legal in the brief, and
 * happens (siblings sharing a parent's address), but it is also how a
 * copy-paste slip looks. Import both and point at the pair.
 */
function sharedEmailWarnings(accepted: Accepted[]): Warning[] {
  const first = new Map<string, Accepted>();
  const out: Warning[] = [];
  for (const a of accepted) {
    const prev = first.get(a.row.email);
    if (!prev) {
      first.set(a.row.email, a);
      continue;
    }
    out.push({
      line: a.line,
      studentId: a.row.studentId,
      code: "SHARED_EMAIL",
      message: `Email ${a.row.email} is also used by ${prev.row.studentId} (${prev.row.fullName}, line ${prev.line}). Both were imported; check they are really different students.`,
      raw: a.raw,
    });
  }
  return out;
}

function sameStudent(before: Record<string, unknown>, row: StudentRow): boolean {
  return (
    before.full_name === row.fullName &&
    before.email === row.email &&
    before.date_of_birth === row.dateOfBirth &&
    before.grade_level === row.gradeLevel &&
    before.section === row.section &&
    SUBJECTS.every((s) => before[s] === row.marks[s])
  );
}

export type Importer = ReturnType<typeof createImporter>;

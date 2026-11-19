import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite through Node's built-in driver: no native module to compile, one
 * file on disk, and plenty fast for a school's worth of students. The schema
 * is small enough to live here as plain SQL.
 */

const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name       TEXT    NOT NULL,
  file_size       INTEGER NOT NULL,
  file_hash       TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  error_message   TEXT,
  as_of_date      TEXT    NOT NULL,           -- "today" used for the age rule
  bytes_read      INTEGER NOT NULL DEFAULT 0,
  rows_read       INTEGER NOT NULL DEFAULT 0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  warnings        INTEGER NOT NULL DEFAULT 0,
  inserted        INTEGER NOT NULL DEFAULT 0,
  updated         INTEGER NOT NULL DEFAULT 0,
  unchanged       INTEGER NOT NULL DEFAULT 0,
  summary         TEXT    NOT NULL DEFAULT '{}', -- JSON: counts by code and by column
  ignored_columns TEXT    NOT NULL DEFAULT '[]', -- JSON array
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS imports_hash ON imports(file_hash);

CREATE TABLE IF NOT EXISTS import_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id   INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  line        INTEGER NOT NULL,
  student_id  TEXT,
  -- 'error': row was rejected. 'warning': row was imported but looks odd.
  severity    TEXT    NOT NULL DEFAULT 'error' CHECK (severity IN ('error','warning')),
  code        TEXT    NOT NULL,   -- the main reason, used for filtering
  problems    TEXT    NOT NULL,   -- JSON array of every problem in the row
  raw         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS import_errors_by_import ON import_errors(import_id, line);
CREATE INDEX IF NOT EXISTS import_errors_by_code ON import_errors(import_id, severity, code);

CREATE TABLE IF NOT EXISTS students (
  student_id      TEXT PRIMARY KEY,
  full_name       TEXT    NOT NULL,
  email           TEXT    NOT NULL,
  date_of_birth   TEXT    NOT NULL,
  grade_level     INTEGER NOT NULL,
  section         TEXT    NOT NULL,
  maths           REAL    NOT NULL,
  science         REAL    NOT NULL,
  english         REAL    NOT NULL,
  social_studies  REAL    NOT NULL,
  second_language REAL    NOT NULL,
  total           REAL    NOT NULL,
  percentage      REAL    NOT NULL,
  grade           TEXT    NOT NULL,
  passed          INTEGER NOT NULL,
  -- lower-case, accent-free copy of id + name + email, so "zoe" finds "Zoë"
  search_text     TEXT    NOT NULL,
  import_id       INTEGER NOT NULL REFERENCES imports(id),
  source_line     INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS students_name    ON students(full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS students_class   ON students(grade_level, section);
CREATE INDEX IF NOT EXISTS students_pct     ON students(percentage);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // An import that was running when the process died will never finish.
  db.exec(
    `UPDATE imports SET status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       error_message = 'The server restarted while this file was being processed. Nothing from it was saved; please upload it again.'
     WHERE status IN ('queued','processing')`,
  );
  return db;
}

/** Runs fn inside a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Letters that do not decompose into "base + accent" under NFKD.
const SPECIAL: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/** Lower-case and strip accents: "Zoë D'Souza" → "zoe d'souza", "Bjørn" → "bjorn". */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[øæœßłđðþı]/g, (c) => SPECIAL[c] ?? c)
    .replace(/[’‘]/g, "'");
}

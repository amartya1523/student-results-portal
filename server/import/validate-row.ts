import {
  COLUMN_LABELS,
  REQUIRED_COLUMNS,
  SUBJECTS,
  clean,
  dateOfBirth,
  email,
  fullName,
  gradeLevel,
  idKey,
  mark,
  section,
  studentId,
  type Column,
  type Problem,
  type Subject,
} from "./rules.ts";

export interface StudentRow {
  studentId: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  gradeLevel: number;
  section: string;
  marks: Record<Subject, number>;
}

export interface HeaderMap {
  /** Column name → index in the record. */
  index: Record<Column, number>;
  width: number;
  ignored: string[];
}

export class HeaderError extends Error {}

/**
 * Column order and case do not matter, surrounding spaces are ignored and
 * extra columns are ignored. Missing columns fail the whole file, because no
 * row could pass without them.
 */
export function mapHeader(fields: string[]): HeaderMap {
  const names = fields.map((f) => clean(f).toLowerCase());
  if (names.every((n) => n === "")) {
    throw new HeaderError("The first line of the file is empty. It must contain the column names.");
  }
  const index = {} as Record<Column, number>;
  const missing: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    const at = names.indexOf(col);
    if (at === -1) missing.push(col);
    else index[col] = at;
  }
  if (missing.length > 0) {
    const found = names.filter(Boolean).slice(0, 12).join(", ");
    throw new HeaderError(
      `The file is missing ${missing.length === 1 ? "a required column" : "required columns"}: ${missing.join(", ")}. ` +
        `The first line has: ${found || "(nothing)"}.`,
    );
  }
  const repeated = REQUIRED_COLUMNS.filter((c) => names.indexOf(c) !== names.lastIndexOf(c));
  if (repeated.length > 0) {
    throw new HeaderError(
      `The column ${repeated.join(", ")} appears more than once in the first line, so we cannot tell which one to use.`,
    );
  }
  const known = new Set<string>(REQUIRED_COLUMNS);
  return {
    index,
    width: fields.length,
    ignored: names.filter((n) => n && !known.has(n)),
  };
}

export type RowOutcome =
  | { kind: "skip" }
  | { kind: "accepted"; row: StudentRow }
  | { kind: "rejected"; studentId: string | null; problems: Problem[] };

export function isBlank(fields: string[]): boolean {
  return fields.every((f) => clean(f) === "");
}

/**
 * Validates one record. `seenIds` is shared across the file: the first row
 * with an ID owns it, even if that row turns out to be invalid, so a later
 * row cannot quietly replace a broken one.
 */
/** Who first used each student ID in the file. */
export type SeenIds = Map<string, { line: number; name: string }>;

export function validateRow(
  fields: string[],
  header: HeaderMap,
  seenIds: SeenIds,
  today: string,
  line: number,
  unterminatedQuote = false,
): RowOutcome {
  if (isBlank(fields)) return { kind: "skip" };

  if (unterminatedQuote) {
    return {
      kind: "rejected",
      studentId: null,
      problems: [
        {
          code: "INVALID_FORMAT",
          field: null,
          message:
            "A quote (\") was opened in this row and never closed, so everything after it up to the end of the file was swallowed into one value.",
        },
      ],
    };
  }

  if (fields.length !== header.width) {
    const expected = header.width;
    return {
      kind: "rejected",
      studentId: idKey(fields[header.index.student_id] ?? "") || null,
      problems: [
        {
          code: "WRONG_FIELD_COUNT",
          field: null,
          message:
            `This row has ${fields.length} values but the header has ${expected}. ` +
              (fields.length < expected
                ? "A value is probably missing, or a comma was left out."
                : "There is an extra value, often a stray comma or a name with a comma that is not in quotes."),
        },
      ],
    };
  }

  const value = (c: Column) => clean(fields[header.index[c]] ?? "");
  const problems: Problem[] = [];

  const rawId = value("student_id");
  const key = idKey(rawId);
  const owner = key ? seenIds.get(key) : undefined;
  if (owner) {
    const who = owner.name ? ` (${owner.name})` : "";
    problems.push({
      code: "DUPLICATE_ID",
      field: "student_id",
      message: `Student ID ${key} is already used on line ${owner.line}${who}. Only the first row with an ID is kept; give this student their own ID.`,
    });
  } else if (key) {
    seenIds.set(key, { line, name: value("full_name").replace(/\s+/g, " ") });
  }

  const missing = REQUIRED_COLUMNS.filter((c) => value(c) === "");
  for (const c of missing) {
    problems.push({
      code: "MISSING_REQUIRED",
      field: c,
      message: `${COLUMN_LABELS[c]} is empty.`,
    });
  }

  const marks: Partial<Record<Subject, number>> = {};
  const out: Partial<Omit<StudentRow, "marks">> = {};
  const check = <T>(c: Column, r: { ok: true; value: T } | { ok: false; problem: Problem }, set: (v: T) => void) => {
    if (value(c) === "") return;
    if (r.ok) set(r.value);
    else problems.push(r.problem);
  };

  check("student_id", studentId(rawId), (v) => (out.studentId = v));
  check("full_name", fullName(value("full_name")), (v) => (out.fullName = v));
  check("email", email(value("email")), (v) => (out.email = v));
  check("date_of_birth", dateOfBirth(value("date_of_birth"), today), (v) => (out.dateOfBirth = v));
  check("grade_level", gradeLevel(value("grade_level")), (v) => (out.gradeLevel = v));
  check("section", section(value("section")), (v) => (out.section = v));
  for (const s of SUBJECTS) check(s, mark(s, value(s)), (v) => (marks[s] = v));

  if (problems.length > 0) {
    return { kind: "rejected", studentId: key || null, problems };
  }
  return { kind: "accepted", row: { ...out, marks } as StudentRow };
}

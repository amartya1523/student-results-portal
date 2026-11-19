/**
 * Column rules for a student result row.
 *
 * Every rule returns either a clean value or a Problem written for a school
 * administrator, not for a developer: say which column, what we found, and
 * what would have been accepted.
 */

export type ErrorCode =
  | "MISSING_REQUIRED"
  | "INVALID_FORMAT"
  | "OUT_OF_RANGE"
  | "DUPLICATE_ID"
  | "WRONG_FIELD_COUNT";

export interface Problem {
  code: ErrorCode;
  /** Column the problem is about, null for whole-row problems. */
  field: string | null;
  message: string;
}

export const SUBJECTS = [
  "maths",
  "science",
  "english",
  "social_studies",
  "second_language",
] as const;
export type Subject = (typeof SUBJECTS)[number];

export const REQUIRED_COLUMNS = [
  "student_id",
  "full_name",
  "email",
  "date_of_birth",
  "grade_level",
  "section",
  ...SUBJECTS,
] as const;
export type Column = (typeof REQUIRED_COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  student_id: "Student ID",
  full_name: "Full name",
  email: "Email",
  date_of_birth: "Date of birth",
  grade_level: "Grade",
  section: "Section",
  maths: "Maths",
  science: "Science",
  english: "English",
  social_studies: "Social studies",
  second_language: "Second language",
};

type Result<T> = { ok: true; value: T } | { ok: false; problem: Problem };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, field: Column, message: string): Result<never> => ({
  ok: false,
  problem: { code, field, message },
});

/** Shows a value back to the admin without dumping a whole paragraph. */
export function quote(value: string): string {
  const v = value.length > 40 ? value.slice(0, 40) + "…" : value;
  return `“${v}”`;
}

// Zero-width characters sneak in from copy-paste and are invisible in Excel.
const INVISIBLE = /[​-‍⁠﻿]/g;

/** Trim (including non-breaking spaces) and drop invisible characters. */
export function clean(value: string): string {
  return value.replace(INVISIBLE, "").trim();
}

// ---------------------------------------------------------------- student_id

const ID_PATTERN = /^[A-Za-z0-9-]{3,20}$/;

export function studentId(v: string): Result<string> {
  if (!ID_PATTERN.test(v)) {
    const why =
      v.length < 3 || v.length > 20
        ? `it is ${v.length} characters long; it must be 3 to 20`
        : "it may only use letters, digits and hyphens";
    return fail("INVALID_FORMAT", "student_id", `Student ID ${quote(v)} is not valid: ${why}.`);
  }
  return ok(v.toUpperCase());
}

/** The key used to spot duplicates, also for IDs that fail validation. */
export function idKey(v: string): string {
  return clean(v).toUpperCase();
}

// ----------------------------------------------------------------- full_name

// Letters and combining marks from any script, plus the punctuation real
// names use: space, apostrophes (straight and curly), comma, hyphen, period.
const NAME_ALLOWED = /^[\p{L}\p{M}' ’,.\-]+$/u;
const HAS_LETTER = /\p{L}/u;

export function fullName(v: string): Result<string> {
  const name = v.normalize("NFC").replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < 2 || length > 100) {
    return fail(
      "OUT_OF_RANGE",
      "full_name",
      `Full name ${quote(name)} is ${length} characters long; it must be 2 to 100.`,
    );
  }
  if (!NAME_ALLOWED.test(name) || !HAS_LETTER.test(name)) {
    const bad = [...name].find((c) => !/[\p{L}\p{M}' ’,.\-]/u.test(c));
    return fail(
      "INVALID_FORMAT",
      "full_name",
      bad
        ? `Full name ${quote(name)} contains ${quote(bad)}, which is not allowed in a name.`
        : `Full name ${quote(name)} has no letters in it.`,
    );
  }
  return ok(name);
}

// --------------------------------------------------------------------- email

// Deliberately practical rather than RFC 5322: one @, a sensible local part,
// and a domain with at least one dot and a letter-only TLD.
const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function email(v: string): Result<string> {
  if (v.length > 254 || !EMAIL.test(v)) {
    return fail(
      "INVALID_FORMAT",
      "email",
      `Email ${quote(v)} is not a valid email address (expected something like name@school.edu).`,
    );
  }
  return ok(v.toLowerCase());
}

// ------------------------------------------------------------- date_of_birth

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const MIN_AGE = 5;
export const MAX_AGE = 25;

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

/** Whole years between dob and today, the way people count birthdays. */
export function ageOn(dob: string, today: string): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

/** @param today YYYY-MM-DD in the school's timezone. */
export function dateOfBirth(v: string, today: string): Result<string> {
  let y: number, m: number, d: number;
  let match = ISO.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = DMY.exec(v))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return fail(
      "INVALID_FORMAT",
      "date_of_birth",
      `Date of birth ${quote(v)} is not in a format we accept. Use YYYY-MM-DD (2012-04-20) or DD/MM/YYYY (20/04/2012).`,
    );
  }
  if (!isRealDate(y, m, d)) {
    return fail(
      "INVALID_FORMAT",
      "date_of_birth",
      `Date of birth ${quote(v)} is not a real calendar date.`,
    );
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (iso > today) {
    return fail(
      "OUT_OF_RANGE",
      "date_of_birth",
      `Date of birth ${quote(v)} is in the future.`,
    );
  }
  const age = ageOn(iso, today);
  if (age < MIN_AGE || age > MAX_AGE) {
    return fail(
      "OUT_OF_RANGE",
      "date_of_birth",
      `Date of birth ${quote(v)} makes the student ${age} years old; students must be ${MIN_AGE} to ${MAX_AGE}.`,
    );
  }
  return ok(iso);
}

// --------------------------------------------------------------- grade_level

export function gradeLevel(v: string): Result<number> {
  if (/^-?\d+$/.test(v)) {
    const n = Number(v);
    if (n < 1 || n > 12) {
      return fail("OUT_OF_RANGE", "grade_level", `Grade ${quote(v)} is outside 1 to 12.`);
    }
    return ok(n);
  }
  return fail(
    "INVALID_FORMAT",
    "grade_level",
    `Grade ${quote(v)} must be a whole number from 1 to 12 (write 9, not “IX” or “9th”).`,
  );
}

// ------------------------------------------------------------------- section

export function section(v: string): Result<string> {
  if (/^[A-Fa-f]$/.test(v)) return ok(v.toUpperCase());
  if (/^[A-Za-z]$/.test(v)) {
    return fail("OUT_OF_RANGE", "section", `Section ${quote(v)} does not exist; sections run from A to F.`);
  }
  return fail("INVALID_FORMAT", "section", `Section ${quote(v)} must be a single letter from A to F.`);
}

// --------------------------------------------------------------------- marks

// Plain decimals only. "1e3", "82/100", "eighty" and "N/A" are rejected on
// purpose: they are almost always a typing or export mistake.
const MARK = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export function mark(subject: Subject, v: string): Result<number> {
  const label = COLUMN_LABELS[subject];
  if (!MARK.test(v)) {
    return fail(
      "INVALID_FORMAT",
      subject,
      `${label} mark ${quote(v)} is not a number. Enter a plain number such as 72 or 72.5.`,
    );
  }
  const n = Number(v);
  if (n < 0 || n > 100) {
    return fail("OUT_OF_RANGE", subject, `${label} mark ${v} is outside 0 to 100.`);
  }
  // Two decimals is more precision than any mark sheet uses; round to avoid
  // float noise like 72.30000000000001 in totals.
  return ok(Math.round(n * 100) / 100);
}

/**
 * Generates realistic, messy student result CSVs *and* remembers exactly what
 * it broke. The answer key makes the generator an independent oracle: tests
 * import a generated file and check the importer rejected precisely the rows
 * the generator spoiled, for the reason it spoiled them.
 */

import type { ErrorCode } from "../server/import/rules.ts";

export interface GenerateOptions {
  rows: number;
  seed: number;
  /** Share of rows that get a deliberate error (0..1). */
  errorRate?: number;
  /** "Today", so ages are predictable. */
  today: string;
}

export interface Generated {
  csv: string;
  expected: {
    rowsRead: number;
    accepted: number;
    rejected: number;
    /** File line → error code the importer should report first. */
    errors: Record<number, ErrorCode>;
  };
}

const FIRST = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
  "Ananya", "Diya", "Saanvi", "Aadhya", "Pari", "Anika", "Navya", "Myra", "Sara", "Kiara",
  "Rohan", "Kabir", "Meera", "Tara", "Neha", "Imran", "Farhan", "Ayesha", "Zoya", "Daniel",
  "Zoë", "Anaïs", "José", "Renée", "Søren", "Noël", "Élise", "Mary-Jane", "Ritu", "Gauri",
];
const LAST = [
  "Sharma", "Verma", "Iyer", "Nair", "Reddy", "Patel", "Shah", "Mehta", "Joshi", "Kulkarni",
  "Banerjee", "Chatterjee", "Das", "Bose", "Gupta", "Singh", "Kaur", "Gill", "Khan", "Pillai",
  "D'Souza", "Fernandes", "Pereira", "Menon", "Hegde", "Rao", "Yadav", "Malhotra", "Kapoor", "O’Neil",
];
const SUBJECT_COUNT = 5;

/** Small, fast, seedable PRNG (mulberry32). Same seed, same file. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    normal: (mean: number, sd: number) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

type Rng = ReturnType<typeof rng>;

interface Student {
  id: string;
  name: string;
  email: string;
  dob: string; // ISO
  grade: number;
  section: string;
  marks: number[];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function makeStudent(r: Rng, i: number, today: string): Student {
  const first = r.pick(FIRST);
  const last = r.pick(LAST);
  const grade = r.int(1, 12);
  // Age roughly matches the grade, like a real school.
  const [ty] = today.split("-").map(Number) as [number];
  const year = ty - (grade + 5) - r.int(0, 1);
  const month = r.int(1, 12);
  const day = r.int(1, 28);
  const ability = r.normal(62, 14);
  const marks = Array.from({ length: SUBJECT_COUNT }, () => {
    const m = Math.min(100, Math.max(0, r.normal(ability, 9)));
    return r.chance(0.3) ? Math.round(m * 10) / 10 : Math.round(m);
  });
  const slug = `${first}.${last}`
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z.]/g, "")
    .toLowerCase();
  return {
    id: `STU${pad(i + 1, 5)}`,
    name: `${first} ${last}`,
    email: `${slug}${i}@example.edu`, // index keeps emails unique
    dob: `${year}-${pad(month)}-${pad(day)}`,
    grade,
    section: "ABCDEF"[r.int(0, 5)]!,
    marks,
  };
}

/** Harmless mess the importer must clean up, never reject. */
function messUp(r: Rng, s: Student): string[] {
  const [y, m, d] = s.dob.split("-");
  const name = s.name.includes("'") || r.chance(0.97) ? s.name : `${s.name.split(" ")[1]}, ${s.name.split(" ")[0]}`;
  const cells = [
    r.chance(0.05) ? s.id.toLowerCase() : s.id,
    r.chance(0.05) ? `   ${name.replace(" ", "    ")} ` : name,
    r.chance(0.05) ? `  ${s.email.toUpperCase()} ` : s.email,
    r.chance(0.25) ? `${d}/${m}/${y}` : s.dob,
    r.chance(0.1) ? pad(s.grade) : String(s.grade),
    r.chance(0.1) ? s.section.toLowerCase() : s.section,
    ...s.marks.map((x) => (r.chance(0.04) ? `  ${x} ` : r.chance(0.1) && Number.isInteger(x) ? `${x}.0` : String(x))),
    `+91 9${r.int(100000000, 999999999)}`, // extra column, ignored
  ];
  return cells;
}

/** Each breaker spoils one thing and says what the importer must report. */
interface Ctx {
  usedIds: string[];
  /** Row index, so spoiled IDs stay unique and don't collide as duplicates. */
  i: number;
}

const BREAKERS: { code: ErrorCode; apply: (r: Rng, c: string[], ctx: Ctx) => string[] | null }[] = [
  { code: "MISSING_REQUIRED", apply: (r, c) => set(c, r.int(1, 10), "") },
  { code: "MISSING_REQUIRED", apply: (_r, c) => set(c, 1, "   ") },
  { code: "INVALID_FORMAT", apply: (r, c) => set(c, 2, r.pick(["diya@", "not-an-email", "a@@b.com", "kabir at school.edu", "x@y"])) },
  { code: "INVALID_FORMAT", apply: (r, c) => set(c, 3, r.pick(["31/02/2012", "2011-13-04", "11-30-2010", "14.03.2011", "tomorrow"])) },
  { code: "OUT_OF_RANGE", apply: (r, c) => set(c, 3, r.pick(["1970-01-01", "2031-05-01", "2024-06-01"])) },
  { code: "INVALID_FORMAT", apply: (r, c) => set(c, 4, r.pick(["IX", "ten", "9th", "7.5"])) },
  { code: "OUT_OF_RANGE", apply: (r, c) => set(c, 4, r.pick(["0", "13", "-2"])) },
  { code: "OUT_OF_RANGE", apply: (r, c) => set(c, 5, r.pick(["Z", "G", "q"])) },
  { code: "INVALID_FORMAT", apply: (r, c) => set(c, 5, r.pick(["AB", "1", "A1"])) },
  { code: "INVALID_FORMAT", apply: (r, c) => set(c, r.int(6, 10), r.pick(["N/A", "abc", "eighty", "82/100", "1e3"])) },
  { code: "OUT_OF_RANGE", apply: (r, c) => set(c, r.int(6, 10), r.pick(["105", "100.5", "-5"])) },
  {
    code: "INVALID_FORMAT",
    apply: (r, c, { i }) => set(c, 0, r.pick([`STU ${i}`, `STU_${i}`, `STU#${i}`, `X${String(i).padStart(20, "0")}`])),
  },
  { code: "INVALID_FORMAT", apply: (_r, c) => set(c, 1, "R2-D2") },
  { code: "WRONG_FIELD_COUNT", apply: (r, c) => (r.chance(0.5) ? [...c.slice(0, 7), ...c.slice(8)] : [...c.slice(0, 11), "extra", ...c.slice(11)]) },
  {
    code: "DUPLICATE_ID",
    apply: (r, c, ctx) => (ctx.usedIds.length ? set(c, 0, r.chance(0.5) ? r.pick(ctx.usedIds).toLowerCase() : r.pick(ctx.usedIds)) : null),
  },
];

function set(cells: string[], i: number, v: string): string[] {
  const out = [...cells];
  out[i] = v;
  return out;
}

function csvLine(cells: string[]): string {
  return cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
}

export function generate(opts: GenerateOptions): Generated {
  const r = rng(opts.seed);
  const errorRate = opts.errorRate ?? 0.07;
  const eol = r.chance(0.5) ? "\r\n" : "\n";
  const header = [
    "student_id", "full_name", "email", "date_of_birth", "grade_level", "section",
    "maths", "science", "english", "social_studies", "second_language", "parent_phone",
  ];
  const lines: string[] = [header.join(",")];
  const errors: Record<number, ErrorCode> = {};
  const usedIds: string[] = [];
  let accepted = 0;

  for (let i = 0; i < opts.rows; i++) {
    // Blank and all-empty lines are skipped and not counted, but they do
    // move line numbers, which is exactly what we want to test.
    if (r.chance(0.004)) lines.push("");
    if (r.chance(0.002)) lines.push(",".repeat(header.length - 1));

    const student = makeStudent(r, i, opts.today);
    let cells = messUp(r, student);
    let code: ErrorCode | null = null;
    if (r.chance(errorRate)) {
      const breaker = r.pick(BREAKERS);
      const broken = breaker.apply(r, cells, { usedIds, i });
      if (broken) {
        cells = broken;
        code = breaker.code;
      }
    }
    lines.push(csvLine(cells));
    if (code) errors[lines.length] = code;
    else accepted++;
    // Every row with an ID claims it, valid or not.
    const id = cells[0]?.trim().toUpperCase();
    if (id && code !== "WRONG_FIELD_COUNT" && code !== "DUPLICATE_ID") usedIds.push(id);
  }

  const bom = r.chance(0.5) ? "﻿" : "";
  return {
    csv: bom + lines.join(eol) + eol,
    expected: {
      rowsRead: opts.rows,
      accepted,
      rejected: Object.keys(errors).length,
      errors,
    },
  };
}

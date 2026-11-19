import type { FastifyInstance } from "fastify";
import { fold, type Db } from "../db.ts";
import { GRADE_BANDS, PASS_MARK, computeResult, gradeFor } from "../grading.ts";
import { COLUMN_LABELS, SUBJECTS, ageOn, type Subject } from "../import/rules.ts";
import { HttpError } from "./http.ts";

interface StudentDbRow {
  student_id: string;
  full_name: string;
  email: string;
  date_of_birth: string;
  grade_level: number;
  section: string;
  maths: number;
  science: number;
  english: number;
  social_studies: number;
  second_language: number;
  total: number;
  percentage: number;
  grade: string;
  passed: number;
  import_id: number;
  source_line: number;
  created_at: string;
  updated_at: string;
}

const SORTS = {
  name: "full_name COLLATE NOCASE",
  id: "student_id",
  class: "grade_level, section",
  percentage: "percentage",
} as const;

export async function studentRoutes(app: FastifyInstance, opts: { db: Db; today: () => string }) {
  const { db } = opts;

  app.get("/api/students", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 25));
    const sortKey = (q.sort && q.sort in SORTS ? q.sort : "name") as keyof typeof SORTS;
    const dir = q.dir === "desc" ? "DESC" : "ASC";

    const where: string[] = [];
    const args: (string | number)[] = [];
    const search = fold((q.q ?? "").trim()).slice(0, 100);
    if (search) {
      // Every word must match somewhere in id, name or email.
      for (const word of search.split(/\s+/).slice(0, 5)) {
        where.push(`search_text LIKE ? ESCAPE '\\'`);
        args.push(`%${word.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
      }
    }
    const grade = Number(q.grade);
    if (Number.isInteger(grade) && grade >= 1 && grade <= 12) {
      where.push(`grade_level = ?`);
      args.push(grade);
    }
    if (q.section && /^[A-F]$/i.test(q.section)) {
      where.push(`section = ?`);
      args.push(q.section.toUpperCase());
    }
    if (q.result === "pass" || q.result === "fail") {
      where.push(`passed = ?`);
      args.push(q.result === "pass" ? 1 : 0);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM students ${clause}`).get(...args) as { n: number };
    const rows = db
      .prepare(
        `SELECT student_id, full_name, email, grade_level, section, total, percentage, grade, passed
           FROM students ${clause}
          ORDER BY ${SORTS[sortKey]} ${dir}, student_id
          LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as unknown as StudentDbRow[];

    return {
      total: n,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(n / pageSize)),
      students: rows.map((r) => ({
        studentId: r.student_id,
        fullName: r.full_name,
        email: r.email,
        gradeLevel: r.grade_level,
        section: r.section,
        total: r.total,
        percentage: r.percentage,
        grade: r.grade,
        passed: r.passed === 1,
      })),
    };
  });

  app.get("/api/students/:id", async (req) => {
    const id = decodeURIComponent((req.params as { id: string }).id).trim().toUpperCase();
    const s = db.prepare(`SELECT * FROM students WHERE student_id = ?`).get(id) as StudentDbRow | undefined;
    if (!s) {
      throw new HttpError(404, "STUDENT_NOT_FOUND", `No student with ID ${id || "(empty)"} has been imported.`);
    }

    const marks = Object.fromEntries(SUBJECTS.map((k) => [k, s[k]])) as Record<Subject, number>;
    const result = computeResult(marks);

    // Context the admin usually wants next to a report: how the class did.
    const classAvg = db
      .prepare(
        `SELECT COUNT(*) AS n, ${SUBJECTS.map((k) => `AVG(${k}) AS ${k}`).join(", ")}, AVG(percentage) AS percentage
           FROM students WHERE grade_level = ? AND section = ?`,
      )
      .get(s.grade_level, s.section) as Record<string, number>;
    const { rank } = db
      .prepare(`SELECT COUNT(*) + 1 AS rank FROM students WHERE grade_level = ? AND section = ? AND percentage > ?`)
      .get(s.grade_level, s.section, s.percentage) as { rank: number };

    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      student: {
        studentId: s.student_id,
        fullName: s.full_name,
        email: s.email,
        dateOfBirth: s.date_of_birth,
        age: ageOn(s.date_of_birth, opts.today()),
        gradeLevel: s.grade_level,
        section: s.section,
        importId: s.import_id,
        sourceLine: s.source_line,
        updatedAt: s.updated_at,
      },
      subjects: SUBJECTS.map((k) => ({
        key: k,
        label: COLUMN_LABELS[k],
        mark: s[k],
        grade: gradeFor(s[k]),
        passed: s[k] >= PASS_MARK,
        classAverage: round(classAvg[k] ?? 0),
      })),
      result,
      classContext: {
        size: classAvg.n ?? 0,
        rank,
        averagePercentage: round(classAvg.percentage ?? 0),
      },
    };
  });

  app.get("/api/stats", async () => {
    const t = db
      .prepare(
        `SELECT COUNT(*) AS students, COALESCE(SUM(passed),0) AS passed, AVG(percentage) AS avg FROM students`,
      )
      .get() as { students: number; passed: number; avg: number | null };
    const grades = db.prepare(`SELECT grade, COUNT(*) AS n FROM students GROUP BY grade`).all() as {
      grade: string;
      n: number;
    }[];
    const classes = db
      .prepare(`SELECT DISTINCT grade_level FROM students ORDER BY grade_level`)
      .all() as { grade_level: number }[];
    return {
      students: t.students,
      passed: t.passed,
      averagePercentage: t.avg === null ? null : Math.round(t.avg * 10) / 10,
      gradeDistribution: GRADE_BANDS.map((b) => ({
        grade: b.grade,
        count: grades.find((g) => g.grade === b.grade)?.n ?? 0,
      })),
      gradeLevels: classes.map((c) => c.grade_level),
    };
  });

  app.get("/api/grading", async () => ({
    passMark: PASS_MARK,
    maxPerSubject: 100,
    bands: GRADE_BANDS,
    rules: [
      "Each subject is marked out of 100, so the total is out of 500.",
      "Percentage is the total divided by 5.",
      `A student passes only if every subject is ${PASS_MARK} or more.`,
      "The overall grade comes from the percentage, rounded to the nearest whole number.",
    ],
  }));
}

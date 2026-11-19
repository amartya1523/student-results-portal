/**
 * Grading scheme (our call, as the brief asks us to decide one).
 *
 * Modelled on the CBSE 8-point scale most Indian schools already use, so an
 * administrator can read it without a legend:
 *
 *   A1 91–100 · A2 81–90 · B1 71–80 · B2 61–70 · C1 51–60 · C2 41–50 · D 33–40 · E below 33
 *
 * - Every subject is out of 100, so the total is out of 500.
 * - Percentage = total / 5, rounded to two decimals.
 * - Pass mark is 33 in *every* subject. One subject below 33 means Fail even
 *   when the percentage looks fine, because that is how schools treat it.
 * - The overall grade comes from the percentage. It is shown even for a
 *   failed student so the teacher can see how close they were.
 */

import { SUBJECTS, type Subject } from "./import/rules.ts";

export const PASS_MARK = 33;
export const MAX_PER_SUBJECT = 100;

export const GRADE_BANDS = [
  { grade: "A1", min: 91, label: "Outstanding" },
  { grade: "A2", min: 81, label: "Excellent" },
  { grade: "B1", min: 71, label: "Very good" },
  { grade: "B2", min: 61, label: "Good" },
  { grade: "C1", min: 51, label: "Above average" },
  { grade: "C2", min: 41, label: "Average" },
  { grade: "D", min: 33, label: "Pass" },
  { grade: "E", min: 0, label: "Needs improvement" },
] as const;

export type Grade = (typeof GRADE_BANDS)[number]["grade"];

/**
 * Bands are inclusive of their lower bound on the rounded score, so 90.5
 * rounds to 91 and gets A1. Rounding first avoids the "90.99 is A2" surprise
 * that parents always ask about.
 */
export function gradeFor(score: number): Grade {
  const s = Math.round(score);
  for (const band of GRADE_BANDS) if (s >= band.min) return band.grade;
  return "E";
}

export interface Result {
  total: number;
  maxTotal: number;
  percentage: number;
  grade: Grade;
  passed: boolean;
  failedSubjects: Subject[];
}

export function computeResult(marks: Record<Subject, number>): Result {
  const total = round2(SUBJECTS.reduce((sum, s) => sum + marks[s], 0));
  const maxTotal = SUBJECTS.length * MAX_PER_SUBJECT;
  const percentage = round2((total / maxTotal) * 100);
  const failedSubjects = SUBJECTS.filter((s) => marks[s] < PASS_MARK);
  return {
    total,
    maxTotal,
    percentage,
    grade: gradeFor(percentage),
    passed: failedSubjects.length === 0,
    failedSubjects,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

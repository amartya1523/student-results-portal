import { describe, expect, it } from "vitest";
import { computeResult, gradeFor } from "../server/grading.ts";

const marks = (m: number, s = m, e = m, ss = m, l = m) => ({
  maths: m,
  science: s,
  english: e,
  social_studies: ss,
  second_language: l,
});

describe("grading", () => {
  it.each([
    [100, "A1"],
    [91, "A1"],
    [90.5, "A1"], // rounds up into the band
    [90.4, "A2"],
    [81, "A2"],
    [71, "B1"],
    [61, "B2"],
    [51, "C1"],
    [41, "C2"],
    [33, "D"],
    [32.4, "E"],
    [0, "E"],
  ])("%d%% is %s", (pct, grade) => expect(gradeFor(pct)).toBe(grade));

  it("totals out of 500 and gives a percentage", () => {
    expect(computeResult(marks(80, 70, 60, 90, 100))).toMatchObject({
      total: 400,
      maxTotal: 500,
      percentage: 80,
      grade: "B1",
      passed: true,
    });
  });

  it("fails a student below 33 in any subject even with a good average", () => {
    const r = computeResult(marks(95, 95, 95, 95, 32.5));
    expect(r.percentage).toBe(82.5);
    expect(r.grade).toBe("A2");
    expect(r.passed).toBe(false);
    expect(r.failedSubjects).toEqual(["second_language"]);
  });

  it("33 exactly is a pass", () => {
    expect(computeResult(marks(33)).passed).toBe(true);
  });

  it("does not leak floating point noise into totals", () => {
    expect(computeResult(marks(0.1, 0.2, 0.3, 0.4, 0.5)).total).toBe(1.5);
  });
});

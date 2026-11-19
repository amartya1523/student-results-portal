import { describe, expect, it } from "vitest";
import {
  ageOn,
  clean,
  dateOfBirth,
  email,
  fullName,
  gradeLevel,
  mark,
  section,
  studentId,
} from "../server/import/rules.ts";

const TODAY = "2026-11-20";

const value = <T>(r: { ok: true; value: T } | { ok: false }) => (r.ok ? r.value : undefined);
const code = (r: { ok: true } | { ok: false; problem: { code: string } }) => (r.ok ? "OK" : r.problem.code);

describe("student_id", () => {
  it.each(["STU00001", "abc", "A-1-B", "x".repeat(20)])("accepts %s", (v) => {
    expect(code(studentId(v))).toBe("OK");
  });
  it.each(["AB", "x".repeat(21), "STU 001", "STU_001", "STU#1"])("rejects %s", (v) => {
    expect(code(studentId(v))).toBe("INVALID_FORMAT");
  });
  it("stores IDs in upper case", () => {
    expect(value(studentId("stu00022"))).toBe("STU00022");
  });
});

describe("full_name", () => {
  it("collapses repeated spaces inside the name", () => {
    expect(value(fullName("Kabir    Das"))).toBe("Kabir Das");
  });
  it.each(["Singh, Aarav", "Zoë D'Souza", "Bjørn Nair", "Ritu Kumārī", "Mary-Jane O’Neil", "李 小龙"])(
    "accepts %s",
    (v) => expect(code(fullName(v))).toBe("OK"),
  );
  it("treats a decomposed accent the same as a composed one", () => {
    expect(value(fullName("Zoë"))).toBe("Zoë");
  });
  it.each(["A", "x".repeat(101)])("rejects bad length %#", (v) => {
    expect(code(fullName(v))).toBe("OUT_OF_RANGE");
  });
  it.each(["Rohan 2", "Asha@home", "Ravi 🙂", "'',"])("rejects %s", (v) => {
    expect(code(fullName(v))).toBe("INVALID_FORMAT");
  });
});

describe("email", () => {
  it("stores email in lower case", () => {
    expect(value(email("ADITYA.PAWAR82@EXAMPLE.EDU"))).toBe("aditya.pawar82@example.edu");
  });
  it.each(["a@b.co", "first.last+tag@school.edu.in"])("accepts %s", (v) => {
    expect(code(email(v))).toBe("OK");
  });
  it.each(["sana@example", "diya@", "@example.edu", "riya@@example.edu", "kabir at example.edu", "a..b@x.com", "a@-x.com"])(
    "rejects %s",
    (v) => expect(code(email(v))).toBe("INVALID_FORMAT"),
  );
});

describe("date_of_birth", () => {
  it("normalises both accepted formats to ISO", () => {
    expect(value(dateOfBirth("2012-04-20", TODAY))).toBe("2012-04-20");
    expect(value(dateOfBirth("20/04/2012", TODAY))).toBe("2012-04-20");
  });
  it.each(["31/02/2012", "2011-13-04", "29/02/2013"])("rejects impossible date %s", (v) => {
    expect(code(dateOfBirth(v, TODAY))).toBe("INVALID_FORMAT");
  });
  it("accepts 29 February in a leap year", () => {
    expect(code(dateOfBirth("29/02/2012", TODAY))).toBe("OK");
  });
  it.each(["11-30-2010", "14.03.2011", "tomorrow", "2012/04/20", "1/2/2012"])("rejects format %s", (v) => {
    expect(code(dateOfBirth(v, TODAY))).toBe("INVALID_FORMAT");
  });
  it("counts age in whole birthdays, inclusive at both ends", () => {
    expect(ageOn("2021-11-20", TODAY)).toBe(5);
    expect(ageOn("2021-11-21", TODAY)).toBe(4);
    expect(code(dateOfBirth("2021-11-20", TODAY))).toBe("OK"); // 5th birthday today
    expect(code(dateOfBirth("2021-11-21", TODAY))).toBe("OUT_OF_RANGE");
    expect(code(dateOfBirth("2001-11-21", TODAY))).toBe("OK"); // still 25
    expect(code(dateOfBirth("2000-11-20", TODAY))).toBe("OUT_OF_RANGE"); // turned 26
  });
  it("rejects future dates and very old dates as out of range", () => {
    expect(code(dateOfBirth("2031-05-01", TODAY))).toBe("OUT_OF_RANGE");
    expect(code(dateOfBirth("1970-01-01", TODAY))).toBe("OUT_OF_RANGE");
  });
});

describe("grade_level", () => {
  it("accepts 9 and 09 as the same grade", () => {
    expect(value(gradeLevel("9"))).toBe(9);
    expect(value(gradeLevel("09"))).toBe(9);
  });
  it.each(["0", "13", "-2"])("flags %s as out of range", (v) => expect(code(gradeLevel(v))).toBe("OUT_OF_RANGE"));
  it.each(["IX", "ten", "9th", "9.0", "9.5"])("flags %s as bad format", (v) =>
    expect(code(gradeLevel(v))).toBe("INVALID_FORMAT"),
  );
});

describe("section", () => {
  it("upper-cases the section", () => expect(value(section("f"))).toBe("F"));
  it.each(["Z", "G"])("treats %s as a section that does not exist", (v) => expect(code(section(v))).toBe("OUT_OF_RANGE"));
  it.each(["AB", "1", "A1"])("treats %s as bad format", (v) => expect(code(section(v))).toBe("INVALID_FORMAT"));
});

describe("marks", () => {
  it.each([
    ["0", 0],
    ["100", 100],
    ["100.0", 100],
    ["72.5", 72.5],
    [".5", 0.5],
    ["58.333", 58.33],
  ])("accepts %s", (v, n) => expect(value(mark("maths", v))).toBe(n));
  it.each(["100.5", "105", "-5", "-0.1"])("flags %s as out of range", (v) => expect(code(mark("maths", v))).toBe("OUT_OF_RANGE"));
  it.each(["1e3", "82/100", "eighty", "N/A", "abc", "7 2", "0x10", "Infinity"])("flags %s as not a number", (v) =>
    expect(code(mark("maths", v))).toBe("INVALID_FORMAT"),
  );
});

describe("clean", () => {
  it("trims normal and non-breaking spaces and removes zero-width characters", () => {
    expect(clean("  STU​001 \t")).toBe("STU001");
  });
});

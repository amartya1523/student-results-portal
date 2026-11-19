import { describe, expect, it } from "vitest";
import { fixture, importAndWait, testApp, upload } from "./helpers.ts";

/**
 * The tests I would show a teammate to convince them the import works:
 * a messy file with every trap we know about, checked row by row.
 */

const HEADER =
  "student_id,full_name,email,date_of_birth,grade_level,section,maths,science,english,social_studies,second_language";
const row = (id: string, extra: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    full_name: "Test Student",
    email: `${id.toLowerCase()}@school.edu`,
    date_of_birth: "2012-01-01",
    grade_level: "9",
    section: "A",
    maths: "50",
    science: "50",
    english: "50",
    social_studies: "50",
    second_language: "50",
    ...extra,
  };
  return [id, ...HEADER.split(",").slice(1).map((c) => base[c])].join(",");
};

describe("importing the messy fixture", () => {
  it("accepts exactly the clean rows and explains every rejected one", async () => {
    const { app } = await testApp();
    const { import: imp } = await importAndWait(app, "messy.csv", fixture("messy.csv"));

    expect(imp).toMatchObject({ status: "completed", rowsRead: 19, accepted: 7, rejected: 12, inserted: 7 });
    expect(imp.ignoredColumns).toEqual(["house"]);

    const { errors } = (await app.inject("/api/imports/1/errors?pageSize=100")).json();
    const byLine = Object.fromEntries(errors.map((e: { line: number; code: string }) => [e.line, e.code]));
    // Line numbers count the header and the blank line 5, as the brief asks.
    expect(byLine).toEqual({
      8: "OUT_OF_RANGE", // born 1970
      9: "OUT_OF_RANGE", // born in the future
      10: "INVALID_FORMAT", // ravi@school
      11: "INVALID_FORMAT", // 1e3
      12: "OUT_OF_RANGE", // 100.5
      13: "OUT_OF_RANGE", // section Z
      14: "INVALID_FORMAT", // grade IX
      15: "INVALID_FORMAT", // 31/02
      16: "MISSING_REQUIRED", // no name
      17: "WRONG_FIELD_COUNT",
      18: "WRONG_FIELD_COUNT",
      19: "DUPLICATE_ID", // GOOD-001 again
    });
  });

  it("stores cleaned values: trimmed, upper-cased IDs, lower-cased emails, ISO dates", async () => {
    const { app } = await testApp();
    await importAndWait(app, "messy.csv", fixture("messy.csv"));

    const zoe = (await app.inject("/api/students/GOOD-003")).json().student;
    expect(zoe).toMatchObject({
      fullName: "Zoë D'Souza",
      email: "zoe.dsouza@school.edu",
      gradeLevel: 7,
      section: "C",
    });
    const aarav = (await app.inject("/api/students/GOOD-002")).json().student;
    expect(aarav).toMatchObject({ fullName: "Singh, Aarav", email: "aarav.singh@school.edu", dateOfBirth: "2012-04-20" });
    // lower-case ID in the file, stored upper-case, findable either way
    expect((await app.inject("/api/students/good-005")).statusCode).toBe(200);
  });

  it("keeps the first row for an ID and names it in the duplicate message", async () => {
    const { app } = await testApp();
    await importAndWait(app, "messy.csv", fixture("messy.csv"));
    const asha = (await app.inject("/api/students/GOOD-001")).json().student;
    expect(asha.fullName).toBe("Asha Verma");
    const { errors } = (await app.inject("/api/imports/1/errors?code=DUPLICATE_ID")).json();
    expect(errors[0].problems[0].message).toContain("line 2 (Asha Verma)");
  });

  it("imports rows that share an email but flags them as warnings", async () => {
    const { app } = await testApp();
    const { import: imp } = await importAndWait(app, "messy.csv", fixture("messy.csv"));
    expect(imp.warnings).toBe(1);
    const { errors } = (await app.inject("/api/imports/1/errors?severity=warning")).json();
    expect(errors[0]).toMatchObject({ line: 20, studentId: "GOOD-006", code: "SHARED_EMAIL" });
  });
});

describe("duplicate rules", () => {
  it("treats IDs as case-insensitive", async () => {
    const { app } = await testApp();
    const csv = [HEADER, row("stu-1"), row("STU-1", { full_name: "Other Person" })].join("\n");
    const { import: imp } = await importAndWait(app, "a.csv", csv);
    expect(imp).toMatchObject({ accepted: 1, rejected: 1, summary: { byCode: { DUPLICATE_ID: 1 } } });
  });

  it("an invalid first row still owns its ID, so a later row cannot sneak in", async () => {
    const { app } = await testApp();
    const csv = [HEADER, row("S-1", { maths: "-5" }), row("S-1")].join("\n");
    const { import: imp } = await importAndWait(app, "a.csv", csv);
    expect(imp).toMatchObject({ accepted: 0, rejected: 2 });
  });

  it("refuses the same file twice unless asked, and a forced re-run changes nothing", async () => {
    const { app } = await testApp();
    const csv = [HEADER, row("S-1"), row("S-2")].join("\n");
    await importAndWait(app, "a.csv", csv);

    const again = await upload(app, "renamed.csv", csv);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "DUPLICATE_FILE" }, previous: { id: 1 } });

    const { import: forced } = await importAndWait(app, "a.csv", csv, "?force=1");
    expect(forced).toMatchObject({ accepted: 2, inserted: 0, updated: 0, unchanged: 2 });
  });

  it("a later file updates existing students and warns when the name changes", async () => {
    const { app } = await testApp();
    await importAndWait(app, "term1.csv", [HEADER, row("S-1", { full_name: "Asha Verma" }), row("S-2")].join("\n"));
    const { import: imp } = await importAndWait(
      app,
      "term2.csv",
      [HEADER, row("S-1", { full_name: "Asha Verma", maths: "90" }), row("S-2", { full_name: "Ravi Kumar" }), row("S-3")].join("\n"),
    );
    expect(imp).toMatchObject({ inserted: 1, updated: 2, unchanged: 0, warnings: 1 });
    const maths = (await app.inject("/api/students/S-1")).json().subjects[0];
    expect(maths).toMatchObject({ key: "maths", mark: 90 });
    const { errors } = (await app.inject("/api/imports/2/errors?severity=warning")).json();
    expect(errors[0]).toMatchObject({ studentId: "S-2", code: "NAME_CHANGED" });
  });
});

describe("files that should fail politely", () => {
  it.each([
    ["missing columns", "student_id,full_name\nS-1,Asha\n", /missing required columns: email/],
    ["header only", HEADER + "\n", /no student rows/],
    ["only blank lines after header", HEADER + "\n\n,,,,,,,,,,\n", /no student rows/],
    ["blank first line", "\n" + HEADER + "\n", /first line of the file is empty/],
    ["repeated column", HEADER + ",email\n", /appears more than once/],
  ])("%s", async (_name, csv, message) => {
    const { app } = await testApp();
    const { import: imp } = await importAndWait(app, "bad.csv", csv);
    expect(imp.status).toBe("failed");
    expect(imp.errorMessage).toMatch(message);
  });

  it("rejects Latin-1 text with advice on how to save as UTF-8", async () => {
    const { app } = await testApp();
    const latin1 = Buffer.from(`${HEADER}\nS-1,M\xfcller Patel,m@s.edu,2012-01-01,9,A,1,1,1,1,1\n`, "latin1");
    const { import: imp } = await importAndWait(app, "latin1.csv", latin1);
    expect(imp).toMatchObject({ status: "failed" });
    expect(imp.errorMessage).toMatch(/UTF-8/);
    // and nothing half-imported is left behind
    expect((await app.inject("/api/students")).json().total).toBe(0);
  });

  it.each([
    ["an Excel workbook", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), /Excel workbook/],
    ["a PDF", Buffer.from("%PDF-1.7 ..."), /PDF/],
    ["binary junk", Buffer.from([0x41, 0x00, 0x42]), /binary/],
  ])("rejects %s before importing", async (_n, content, message) => {
    const { app } = await testApp();
    const res = await upload(app, "results.csv", content);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(message);
  });

  it("rejects non-CSV file names, empty files and oversize files", async () => {
    const { app } = await testApp({ maxUploadBytes: 1024 });
    expect((await upload(app, "results.xlsx", "x")).statusCode).toBe(415);
    expect((await upload(app, "results.csv", "")).statusCode).toBe(422);
    const big = await upload(app, "big.csv", HEADER + "\n" + row("S-1").repeat(50));
    expect(big.statusCode).toBe(413);
    expect(big.json().error.message).toMatch(/larger than/);
  });

  it("an unclosed quote rejects that row and keeps the earlier good rows", async () => {
    const { app } = await testApp();
    const csv = [HEADER, row("S-1"), `S-2,"Broken Name,x@y.com,2012-01-01,9,A,1,1,1,1,1`, row("S-3")].join("\n");
    const { import: imp } = await importAndWait(app, "q.csv", csv);
    expect(imp).toMatchObject({ status: "completed", accepted: 1, rejected: 1 });
  });

  it("the server keeps answering after a bad file", async () => {
    const { app } = await testApp();
    await importAndWait(app, "bad.csv", "garbage");
    expect((await app.inject("/api/health")).json()).toEqual({ ok: true });
  });
});

describe("big files", () => {
  it("imports 20,000 rows and reports progress along the way", async () => {
    const { app } = await testApp();
    const lines = [HEADER];
    for (let i = 0; i < 20_000; i++) lines.push(row(`S-${i}`));
    const { import: imp } = await importAndWait(app, "big.csv", lines.join("\r\n"));
    expect(imp).toMatchObject({ status: "completed", accepted: 20_000, progress: 1 });
  });
});

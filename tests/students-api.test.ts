import { beforeAll, describe, expect, it } from "vitest";
import { importAndWait, testApp } from "./helpers.ts";

const HEADER =
  "student_id,full_name,email,date_of_birth,grade_level,section,maths,science,english,social_studies,second_language";

let app: Awaited<ReturnType<typeof testApp>>["app"];

beforeAll(async () => {
  ({ app } = await testApp());
  const rows = [
    `A-1,Zoë D'Souza,zoe@s.edu,2012-01-01,9,A,90,90,90,90,90`,
    `A-2,Bjørn Nair,bjorn@s.edu,2012-01-01,9,A,20,90,90,90,90`,
    `A-3,Asha Verma,asha@s.edu,2012-01-01,9,B,50,50,50,50,50`,
    `A-4,"Singh, Aarav",aarav@s.edu,2013-01-01,8,A,70,70,70,70,70`,
  ];
  for (let i = 0; i < 60; i++) rows.push(`B-${String(i).padStart(3, "0")},Filler Kid,f${i}@s.edu,2014-01-01,7,C,60,60,60,60,60`);
  await importAndWait(app, "s.csv", [HEADER, ...rows].join("\n"));
});

const list = async (qs: string) => (await app.inject(`/api/students?${qs}`)).json();

describe("GET /api/students", () => {
  it("pages through everyone", async () => {
    const p1 = await list("pageSize=25");
    expect(p1).toMatchObject({ total: 64, pages: 3, page: 1 });
    expect(p1.students).toHaveLength(25);
    const p3 = await list("pageSize=25&page=3");
    expect(p3.students).toHaveLength(14);
  });

  it("finds names without typing accents", async () => {
    expect((await list("q=zoe")).students.map((s: { studentId: string }) => s.studentId)).toEqual(["A-1"]);
    expect((await list("q=bjorn")).students.map((s: { studentId: string }) => s.studentId)).toEqual(["A-2"]);
  });

  it("matches every word, in any order, across id, name and email", async () => {
    expect((await list("q=aarav singh")).total).toBe(1);
    expect((await list("q=a-3")).total).toBe(1);
    expect((await list("q=asha@s")).total).toBe(1);
  });

  it("does not treat % and _ as wildcards", async () => {
    expect((await list("q=%25")).total).toBe(0);
    expect((await list("q=_")).total).toBe(0);
  });

  it("filters by grade, section and result", async () => {
    expect((await list("grade=9")).total).toBe(3);
    expect((await list("grade=9&section=a")).total).toBe(2);
    expect((await list("result=fail")).students.map((s: { studentId: string }) => s.studentId)).toEqual(["A-2"]);
  });

  it("sorts by percentage", async () => {
    const top = (await list("sort=percentage&dir=desc&pageSize=5")).students[0];
    expect(top.studentId).toBe("A-1");
  });

  it("ignores nonsense parameters instead of failing", async () => {
    const r = await app.inject("/api/students?page=-4&pageSize=99999&sort=drop%20table&grade=banana");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ page: 1, pageSize: 100, total: 64 });
  });
});

describe("GET /api/students/:id", () => {
  it("returns the report with result and class context", async () => {
    const r = (await app.inject("/api/students/a-2")).json();
    expect(r.student).toMatchObject({ studentId: "A-2", fullName: "Bjørn Nair", age: 14 });
    expect(r.result).toMatchObject({ total: 380, percentage: 76, grade: "B1", passed: false, failedSubjects: ["maths"] });
    expect(r.classContext).toMatchObject({ size: 2, rank: 2 });
    expect(r.subjects[0]).toMatchObject({ key: "maths", mark: 20, passed: false, classAverage: 55 });
  });

  it("gives a clear 404 for an unknown student", async () => {
    const r = await app.inject("/api/students/NOPE-1");
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toMatchObject({ code: "STUDENT_NOT_FOUND" });
  });
});

describe("GET /api/stats", () => {
  it("summarises the school", async () => {
    const s = (await app.inject("/api/stats")).json();
    expect(s).toMatchObject({ students: 64, passed: 63, gradeLevels: [7, 8, 9] });
  });
});

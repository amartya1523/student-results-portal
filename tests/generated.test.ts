import { describe, expect, it } from "vitest";
import { generate } from "../scripts/generate.ts";
import { TODAY, importAndWait, testApp } from "./helpers.ts";

/**
 * Property-style check: for many random messy files, the importer must agree
 * with the generator's answer key line by line. A bug in any rule shows up as
 * a line the two disagree on, which makes failures easy to read.
 */
describe("importer vs. generator answer key", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("seed %i", async (seed) => {
    const { csv, expected } = generate({ rows: 600, seed, today: TODAY, errorRate: 0.2 });
    const { app } = await testApp();
    const { import: imp } = await importAndWait(app, `gen-${seed}.csv`, csv);

    const { errors } = (await app.inject("/api/imports/1/errors?pageSize=200")).json();
    const actual = Object.fromEntries(errors.map((e: { line: number; code: string }) => [e.line, e.code]));

    expect(actual).toEqual(expected.errors);
    expect(imp).toMatchObject({
      status: "completed",
      rowsRead: expected.rowsRead,
      accepted: expected.accepted,
      rejected: expected.rejected,
      warnings: 0,
    });
  });

  it("is repeatable: the same seed gives the same file", () => {
    expect(generate({ rows: 50, seed: 9, today: TODAY }).csv).toBe(generate({ rows: 50, seed: 9, today: TODAY }).csv);
  });
});

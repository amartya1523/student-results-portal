import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importAndWait, testApp } from "./helpers.ts";

/**
 * Checks the numbers in the sample pack README. The pack is confidential, so
 * it is not committed: drop the files into ./sample-pack (or point
 * SAMPLE_PACK_DIR at them) and these tests switch on.
 */
const dir = process.env.SAMPLE_PACK_DIR ?? join(import.meta.dirname, "..", "sample-pack");
const has = (f: string) => existsSync(join(dir, f));

describe.skipIf(!has("students_small.csv") || !has("students_sample.csv"))("official sample pack", () => {
  it.each([
    ["students_small.csv", 25, 16, 9],
    ["students_sample.csv", 5000, 4685, 315],
  ])("%s → read %i, imported %i, rejected %i", async (file, read, accepted, rejected) => {
    const { app } = await testApp();
    const { import: imp } = await importAndWait(app, file, readFileSync(join(dir, file)));
    expect(imp).toMatchObject({ status: "completed", rowsRead: read, accepted, rejected });
  });
});

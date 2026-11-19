/**
 * npm run seed                         write data/seed/students_seed.csv (5,000 rows)
 * npm run seed -- --rows 20000         bigger file
 * npm run seed -- --seed 7             different (but repeatable) data
 * npm run seed -- --load               also upload it to a running portal
 * npm run seed -- --load --url http://localhost:3000
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { todayIn } from "../server/app.ts";
import { generate } from "./generate.ts";

const { values } = parseArgs({
  options: {
    rows: { type: "string", default: "5000" },
    seed: { type: "string", default: "42" },
    "error-rate": { type: "string", default: "0.07" },
    out: { type: "string", default: join(resolve(import.meta.dirname, ".."), "data", "seed", "students_seed.csv") },
    load: { type: "boolean", default: false },
    url: { type: "string", default: process.env.PORTAL_URL ?? "http://localhost:3000" },
  },
});

const rows = Number(values.rows);
const seed = Number(values.seed);
if (!Number.isInteger(rows) || rows < 1) throw new Error("--rows must be a positive whole number");

const today = todayIn(process.env.SCHOOL_TIMEZONE ?? "Asia/Kolkata");
const { csv, expected } = generate({ rows, seed, today, errorRate: Number(values["error-rate"]) });

mkdirSync(resolve(values.out!, ".."), { recursive: true });
writeFileSync(values.out!, csv);
writeFileSync(values.out!.replace(/\.csv$/, ".expected.json"), JSON.stringify(expected, null, 2));

console.log(`Wrote ${values.out}`);
console.log(`  ${rows} rows · expect ${expected.accepted} imported, ${expected.rejected} rejected (seed ${seed})`);

if (values.load) {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "students_seed.csv");
  const res = await fetch(`${values.url}/api/imports?force=1`, { method: "POST", body: form }).catch((err) => {
    console.error(`Could not reach ${values.url}. Is the portal running? (${(err as Error).message})`);
    process.exit(1);
  });
  const body = (await res.json()) as { import?: { id: number }; error?: { message: string } };
  if (!res.ok || !body.import) {
    console.error(`Upload failed: ${body.error?.message ?? res.status}`);
    process.exit(1);
  }
  const id = body.import.id;
  process.stdout.write(`Uploaded as import #${id}, waiting`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const { import: imp } = (await (await fetch(`${values.url}/api/imports/${id}`)).json()) as {
      import: { status: string; accepted: number; rejected: number; errorMessage: string | null };
    };
    process.stdout.write(".");
    if (imp.status === "completed") {
      console.log(`\nDone: ${imp.accepted} imported, ${imp.rejected} rejected. Open ${values.url}/import/${id}`);
      break;
    }
    if (imp.status === "failed") {
      console.log(`\nImport failed: ${imp.errorMessage}`);
      process.exit(1);
    }
  }
}

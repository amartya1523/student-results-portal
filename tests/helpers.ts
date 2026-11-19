import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../server/app.ts";
import { openDb } from "../server/db.ts";

/** All tests pretend today is the day the brief was received. */
export const TODAY = "2026-11-20";

export async function testApp(opts: { maxUploadBytes?: number } = {}) {
  const db = openDb(":memory:");
  const app = await buildApp({
    db,
    uploadDir: mkdtempSync(join(tmpdir(), "srp-test-")),
    today: () => TODAY,
    maxUploadBytes: opts.maxUploadBytes,
  });
  return { app, db };
}

type App = Awaited<ReturnType<typeof testApp>>["app"];

export function fixture(name: string): Buffer {
  return readFileSync(join(import.meta.dirname, "fixtures", name));
}

export async function upload(app: App, fileName: string, content: string | Buffer, query = "") {
  const form = new FormData();
  form.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)]), fileName);
  return app.inject({ method: "POST", url: `/api/imports${query}`, payload: form });
}

/** Uploads and waits for the background import to finish. */
export async function importAndWait(app: App, fileName: string, content: string | Buffer, query = "") {
  const res = await upload(app, fileName, content, query);
  if (res.statusCode !== 202) return { res, import: null };
  const id = res.json().import.id as number;
  for (let i = 0; i < 400; i++) {
    const imp = (await app.inject(`/api/imports/${id}`)).json().import;
    if (imp.status === "completed" || imp.status === "failed") return { res, import: imp };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`import ${id} did not finish`);
}

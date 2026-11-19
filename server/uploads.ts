import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Saves an upload to disk while hashing it and sniffing the first bytes, so
 * we can say "this is an Excel workbook" instead of "row 1 is invalid".
 */

export class UploadRejected extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export interface SavedUpload {
  path: string;
  size: number;
  hash: string;
}

const SNIFF_BYTES = 8 * 1024;

export async function saveUpload(file: Readable, dir: string): Promise<SavedUpload> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.csv`);
  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);

  const inspect = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (head.length < SNIFF_BYTES) {
        head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
        const problem = sniff(head);
        if (problem) return done(problem);
      }
      size += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    await pipeline(file, inspect, createWriteStream(path));
  } catch (err) {
    await unlink(path).catch(() => undefined);
    throw err;
  }
  if ((file as Readable & { truncated?: boolean }).truncated) {
    await unlink(path).catch(() => undefined);
    throw new UploadRejected("", "FILE_TOO_LARGE");
  }
  if (size === 0) {
    await unlink(path).catch(() => undefined);
    throw new UploadRejected("The file is empty (0 bytes).", "EMPTY_FILE");
  }
  return { path, size, hash: hash.digest("hex") };
}

function sniff(head: Buffer): UploadRejected | null {
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return new UploadRejected(
      "This looks like an Excel workbook (.xlsx), not a CSV. In Excel choose File → Save As → “CSV UTF-8 (Comma delimited)” and upload that file.",
      "NOT_CSV",
    );
  }
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return new UploadRejected(
      "This looks like an old Excel file (.xls), not a CSV. Save it as “CSV UTF-8” and upload again.",
      "NOT_CSV",
    );
  }
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") {
    return new UploadRejected("This is a PDF. The portal needs the CSV export of the results spreadsheet.", "NOT_CSV");
  }
  if (head.includes(0)) {
    return new UploadRejected(
      "This file contains binary data, so it is not a CSV text file. If it came from Excel, use “Save As → CSV UTF-8”.",
      "NOT_CSV",
    );
  }
  return null;
}

/**
 * A small streaming CSV reader built for one job: reading spreadsheet exports
 * while remembering where every record started in the file.
 *
 * Why not a library? The error report has to quote *file line numbers*
 * (header = line 1, blank lines counted). Most CSV parsers either drop blank
 * lines or report record indexes, so we would have to re-derive line numbers
 * anyway. The grammar is small enough that owning it is cheaper than fighting
 * a dependency.
 *
 * Handles: UTF-8 with or without BOM, \n, \r\n and lone \r line endings,
 * quoted fields with commas, escaped quotes ("") and embedded newlines.
 */

export interface CsvRecord {
  /** 1-based line number where the record starts. */
  line: number;
  fields: string[];
  /** The record as it appeared in the file, capped for the error report. */
  raw: string;
  /** True when a quoted field was still open at end of file. */
  unterminatedQuote: boolean;
}

export class FileEncodingError extends Error {}

const RAW_LIMIT = 500;

export async function* readCsv(
  source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
): AsyncGenerator<CsvRecord> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

  let fields: string[] = [];
  let field = "";
  let raw = "";
  let inQuotes = false;
  let quotePending = false; // inside quotes, just saw '"', next char decides
  let fieldStarted = false; // saw any char for this field (used for quote rules)
  let line = 1;
  let recordLine = 1;
  let pendingCR = false; // previous chunk ended with \r, we may see \n next

  const pushRaw = (s: string) => {
    if (raw.length < RAW_LIMIT) raw += s;
  };

  const endRecord = (): CsvRecord => {
    fields.push(field);
    const rec: CsvRecord = {
      line: recordLine,
      fields,
      raw: raw.length >= RAW_LIMIT ? raw.slice(0, RAW_LIMIT) + "…" : raw,
      unterminatedQuote: false,
    };
    fields = [];
    field = "";
    raw = "";
    fieldStarted = false;
    return rec;
  };

  function* consume(text: string): Generator<CsvRecord> {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;

      if (pendingCR) {
        pendingCR = false;
        if (ch === "\n") continue; // second half of \r\n, already counted
      }

      if (quotePending) {
        // We saw a quote inside a quoted field. Another quote means an
        // escaped literal quote; anything else means the field was closed.
        quotePending = false;
        if (ch === '"') {
          field += '"';
          pushRaw('"');
          continue;
        }
        inQuotes = false;
      }

      if (inQuotes) {
        if (ch === '"') {
          quotePending = true;
          pushRaw('"');
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          line++;
          if (ch === "\r") pendingCR = true;
          field += "\n";
          pushRaw(ch);
          continue;
        }
        field += ch;
        pushRaw(ch);
        continue;
      }

      if (ch === '"') {
        if (!fieldStarted) {
          inQuotes = true;
          fieldStarted = true;
          pushRaw('"');
          continue;
        }
        // A stray quote in the middle of an unquoted field: keep it
        // literally, the way spreadsheets do.
        field += '"';
        pushRaw('"');
        continue;
      }
      if (ch === ",") {
        fields.push(field);
        field = "";
        fieldStarted = false;
        pushRaw(",");
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r") pendingCR = true;
        yield endRecord();
        line++;
        recordLine = line;
        continue;
      }
      field += ch;
      fieldStarted = true;
      pushRaw(ch);
    }
  }

  let first = true;
  for await (const chunk of source) {
    let text: string;
    try {
      text =
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
    } catch {
      throw new FileEncodingError(
        "The file is not valid UTF-8 text. In Excel use “Save As → CSV UTF-8”, then upload again.",
      );
    }
    if (first && text.length > 0) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      first = false;
    }
    yield* consume(text);
  }
  try {
    const tail = decoder.decode();
    if (tail) yield* consume(tail);
  } catch {
    throw new FileEncodingError(
      "The file ends with a broken character. Save it again as “CSV UTF-8” and re-upload.",
    );
  }

  // A quote at the very end of the file closes its field.
  if (quotePending) {
    quotePending = false;
    inQuotes = false;
  }

  // Last record without a trailing newline.
  if (field !== "" || fields.length > 0 || inQuotes) {
    const rec = endRecord();
    rec.unterminatedQuote = inQuotes;
    yield rec;
  }
}

/** Convenience for tests and small inputs. */
export async function readCsvText(text: string): Promise<CsvRecord[]> {
  const out: CsvRecord[] = [];
  for await (const r of readCsv([text])) out.push(r);
  return out;
}

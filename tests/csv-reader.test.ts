import { describe, expect, it } from "vitest";
import { FileEncodingError, readCsv, readCsvText } from "../server/import/csv-reader.ts";

const lines = async (text: string) =>
  (await readCsvText(text)).map((r) => [r.line, r.fields] as const);

/** Feeds the text one character at a time to catch chunk-boundary bugs. */
async function readInTinyChunks(text: string) {
  const bytes = new TextEncoder().encode(text);
  const chunks = [...bytes].map((b) => new Uint8Array([b]));
  const out = [];
  for await (const r of readCsv(chunks)) out.push([r.line, r.fields] as const);
  return out;
}

describe("readCsv", () => {
  it("splits simple rows and numbers lines from 1", async () => {
    expect(await lines("a,b\n1,2\n3,4\n")).toEqual([
      [1, ["a", "b"]],
      [2, ["1", "2"]],
      [3, ["3", "4"]],
    ]);
  });

  it("treats CRLF, LF and lone CR the same", async () => {
    const expected = [
      [1, ["a"]],
      [2, ["b"]],
      [3, ["c"]],
    ];
    expect(await lines("a\r\nb\r\nc\r\n")).toEqual(expected);
    expect(await lines("a\nb\nc")).toEqual(expected);
    expect(await lines("a\rb\rc\r")).toEqual(expected);
  });

  it("strips a UTF-8 byte order mark from the first column name", async () => {
    const rows = await lines("﻿student_id,name\nS1,x\n");
    expect(rows[0]![1][0]).toBe("student_id");
  });

  it("keeps blank lines so line numbers stay true to the file", async () => {
    expect(await lines("h\n1\n\n2\n")).toEqual([
      [1, ["h"]],
      [2, ["1"]],
      [3, [""]],
      [4, ["2"]],
    ]);
  });

  it("handles quoted commas, escaped quotes and embedded newlines", async () => {
    const rows = await lines('id,name\n1,"Singh, Aarav"\n2,"say ""hi"""\n3,"two\nlines"\n4,x\n');
    expect(rows).toEqual([
      [1, ["id", "name"]],
      [2, ["1", "Singh, Aarav"]],
      [3, ["2", 'say "hi"']],
      [4, ["3", "two\nlines"]],
      [6, ["4", "x"]], // the quoted newline used up line 5
    ]);
  });

  it("gives the same answer when bytes arrive one at a time", async () => {
    const text = '﻿id,name\r\n1,"Singh, Aarav"\r\n\r\n2,"a ""b"""\r\n3,Zoë\r\n';
    expect(await readInTinyChunks(text)).toEqual(await lines(text));
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const rows = await readInTinyChunks("name\nBjørn Ångström\n");
    expect(rows[1]![1]).toEqual(["Bjørn Ångström"]);
  });

  it("flags a quote that is never closed instead of hanging", async () => {
    const rows = await readCsvText('a,b\n1,"oops\n2,3\n');
    expect(rows.at(-1)!.unterminatedQuote).toBe(true);
  });

  it("rejects bytes that are not UTF-8 with a readable message", async () => {
    const latin1 = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
    const consume = async () => {
      for await (const _ of readCsv([latin1])) void _;
    };
    await expect(consume()).rejects.toBeInstanceOf(FileEncodingError);
  });

  it("returns nothing for an empty file", async () => {
    expect(await lines("")).toEqual([]);
  });
});

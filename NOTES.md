# NOTES

One page on what I decided, why, and what I'd do next.

## Stack, and why

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript end to end | One language for rules, API and UI. Node 24 runs `.ts` directly, so the server has no build step. |
| API | Fastify 5 | Small, fast, good multipart streaming, `inject()` makes API tests cheap. |
| Database | SQLite via Node's built-in `node:sqlite` | One file, no server, no native module to compile. Thousands of students is tiny for SQLite. Moving to Postgres later only touches `db.ts` and the SQL in two route files. |
| UI | React 19 + Vite, hand-written CSS | Three screens don't need a component library. |
| CSV | My own ~150-line streaming reader | The error report needs **file line numbers** (header = 1, blank lines counted). Most parsers drop blank lines or report record indexes. Owning it also let me test it byte by byte. |

**Data model:** `students` (one row per ID, cleaned values plus computed total, percentage, grade and pass), `imports` (one row per upload: status, progress, counts, summary), `import_errors` (one row per rejected or flagged row, with every problem as JSON and the original text).

**API:** `POST /api/imports` (202 + id), `GET /api/imports/:id` (poll for progress), `GET /api/imports/:id/errors` (paged, filter by code or warnings), `GET /api/imports/:id/errors.csv`, `GET /api/students` (search, filters, sort, pages), `GET /api/students/:id`, `GET /api/stats`, `GET /api/grading`.

## What counts as a valid row

I followed the column rules in the sample pack README exactly, and both sample files give the expected numbers (25 → 16/9 and 5,000 → 4,685/315; there is a test for it). Where the README was silent, I decided:

- **Every problem in a row is listed, not just the first.** The row's main code (used for counts) is the most decisive one: broken row, then duplicate, then column order.
- **Names:** letters from any script, plus space, apostrophe (`'` and `’`), comma, hyphen and full stop. Digits and symbols are rejected. Unicode is normalised to NFC, so a decomposed “Zoë” matches a composed one.
- **Marks:** plain decimals only. `1e3`, `82/100`, `N/A`, `eighty` are `INVALID_FORMAT`; `-5`, `105`, `100.5` are `OUT_OF_RANGE`. Stored rounded to 2 decimals.
- **Dates:** strictly `YYYY-MM-DD` or `DD/MM/YYYY` (so `1/2/2012` is rejected: easy to relax, risky to guess). Age is counted in whole birthdays against **today in Asia/Kolkata**, inclusive at 5 and 25, and the date used is stored on the import so results can be explained later.
- **Section:** a letter outside A–F (`Z`) is `OUT_OF_RANGE`; anything else (`AB`, `1`) is `INVALID_FORMAT`.
- Trim also removes non-breaking spaces and invisible zero-width characters from copy-paste.

## Duplicates and re-uploads

- **Same ID twice in a file:** the first row owns the ID **even if that row is invalid**, so a later row can't quietly replace a broken one. The duplicate message names who owns it (“already used on line 196 (Myra O’Neil)”). In the sample file all 60 duplicates are *different* students sharing an ID, which is why naming the owner matters.
- **Same file uploaded again:** detected by SHA-256 of the bytes (renaming doesn't fool it). The admin is told when it was imported and can still choose “import again”, which reports *0 new, 0 updated, N unchanged*.
- **A student already in the portal:** a newer file **updates** them (term results get corrected). Each import reports new / updated / unchanged.
- **Warnings, not errors:** rows are still imported but flagged when two different IDs share an email (76 valid rows in the sample) or when an existing ID arrives with a different name. Rejecting these would go beyond the rules; hiding them would leave the admin guessing.

## Bad files, big files, slow imports

- An import is **all or nothing per file**: rows are validated while streaming, then written in **one transaction**. A crash or a broken file can't leave half an import behind. Bad *rows* never block good rows.
- Refused up front with a clear fix: `.xlsx`/`.xls` (sniffed by magic bytes, even if renamed `.csv`), PDF, binary files, non-UTF-8 text, empty files, files over 50 MB, missing or repeated columns, header-only files.
- Imports run in the background, one at a time (so two uploads can't race on the same student). The UI polls progress. If the server restarts mid-import, the import is marked failed with “nothing was saved, upload again”.
- 30,000 rows import in about a second locally; a test imports 20,000.

## Grading scheme (my call)

CBSE-style 8-point scale, because Indian school staff already read it: A1 91–100, A2 81–90, B1 71–80, B2 61–70, C1 51–60, C2 41–50, D 33–40, E below 33. Total out of 500, percentage = total / 5. **Pass needs 33 in every subject**, so a student with 82% who scored 30 in one subject fails, and the report says which subject. Grade bands use the rounded percentage (90.5 → A1).

## How I'd convince a teammate the import works

`npm test` runs 152 tests in about 2 seconds:
1. **Reader tests,** including feeding the file one byte at a time. That test found a real bug: an escaped `""` split across two chunks.
2. **A rule-by-rule table** for every column, including age on the exact birthday and 29 February.
3. **A hand-made messy fixture** checked line by line, plus file-level failures (Latin-1, `.xlsx`, missing columns, unclosed quote, oversize).
4. **An independent oracle:** the seed generator records which rows it broke and why. Twelve random 600-row files are imported and must match the answer key line for line.
5. **Official numbers:** if the sample pack is in `./sample-pack`, the 16/9 and 4,685/315 counts are checked.

## What I left out, and what I'd do next

- **Auth and roles.** It's an admin tool on one machine; next would be a login and an audit log of who imported what.
- **Fixing rows in the browser.** Today the admin downloads the rejected rows CSV, fixes it, and re-uploads. Inline editing of a rejected row would be the next big UX step.
- **Undo an import** (keep a snapshot per import), and **terms/years** as a first-class idea instead of “the latest file wins”.
- **Scale:** past roughly a million rows I'd move to Postgres, run imports in a worker with a real queue, and use full-text search instead of `LIKE`.
- **Hidden test file:** I built for the rules, not the sample. Any rule I'd still question with the team: should `1/2/2012` and names with digits be allowed? Both are one-line changes in `server/import/rules.ts`.

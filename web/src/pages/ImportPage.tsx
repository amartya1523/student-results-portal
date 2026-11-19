import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, uploadCsv, type ImportInfo, type RowIssue } from "../api.ts";
import { EmptyState, ErrorState, Icons, Pager, SkeletonRows, StatusPill } from "../components/ui.tsx";
import { CODE_LABELS, FIELD_LABELS, bytes, dateTime, num, plural } from "../format.ts";
import { useApi, useDocumentTitle, useInterval } from "../hooks.ts";

const MAX_MB = 50;

export function ImportPage() {
  const { id } = useParams();
  const history = useApi<{ imports: ImportInfo[] }>(`/api/imports?for=${id ?? "new"}`);
  useDocumentTitle(id ? `Import #${id}` : "Import results");

  return (
    <div className="import-layout">
      <div className="import-main">
        {id ? (
          <ImportDetail id={Number(id)} onFinished={history.reload} />
        ) : (
          <>
            <header className="page-head">
              <h1>Import term results</h1>
              <p className="lead">
                Upload the CSV your teachers sent. Good rows go straight in; every row we can’t use comes back with a
                reason you can fix.
              </p>
            </header>
            <UploadCard />
            <FileRules />
          </>
        )}
      </div>
      <aside className="import-side">
        <h2 className="side-title">Recent imports</h2>
        {history.state === "error" && <ErrorState error={history.error} onRetry={history.reload} />}
        {history.data && history.data.imports.length === 0 && <p className="muted small">Nothing imported yet.</p>}
        <ul className="history">
          {history.data?.imports.map((imp) => (
            <li key={imp.id}>
              <Link to={`/import/${imp.id}`} className={String(imp.id) === id ? "active" : undefined}>
                <span className="history-name" title={imp.fileName}>
                  {imp.fileName}
                </span>
                <span className="history-meta">
                  #{imp.id} · {dateTime(imp.createdAt)}
                </span>
                <span className="history-meta">
                  <StatusPill status={imp.status} />
                  {imp.status === "completed" && (
                    <span>
                      {num(imp.accepted)} in · {num(imp.rejected)} out
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {id && (
          <Link className="btn btn-block" to="/import">
            + Import another file
          </Link>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ upload

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "duplicate"; previous: ImportInfo; message: string }
  | { kind: "error"; message: string };

function UploadCard() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  const choose = (f: File | undefined) => {
    if (!f) return;
    setState({ kind: "idle" });
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setFile(null);
      setState({
        kind: "error",
        message: `“${f.name}” is not a CSV file. In Excel use File → Save As → “CSV UTF-8”, then choose that file.`,
      });
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setFile(null);
      setState({ kind: "error", message: `This file is ${bytes(f.size)}. The limit is ${MAX_MB} MB; split it by grade and upload each part.` });
      return;
    }
    setFile(f);
  };

  const start = async (force = false) => {
    if (!file) return;
    setState({ kind: "uploading", progress: 0 });
    try {
      const { import: imp } = await uploadCsv(file, {
        force,
        onProgress: (p) => setState({ kind: "uploading", progress: p }),
      });
      navigate(`/import/${imp.id}`);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "DUPLICATE_FILE") {
        const body = e.body as { previous: ImportInfo };
        setState({ kind: "duplicate", previous: body.previous, message: e.message });
      } else {
        setState({ kind: "error", message: e.message });
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  };

  const busy = state.kind === "uploading";

  return (
    <section className="card upload-card">
      <div
        className={`dropzone${dragging ? " dragging" : ""}${file ? " has-file" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        aria-label="Choose a CSV file to upload"
      >
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,.txt"
          hidden
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className="file-chip" onClick={(e) => e.stopPropagation()}>
            <span className="file-icon">{Icons.file}</span>
            <span>
              <b>{file.name}</b>
              <span className="muted"> · {bytes(file.size)}</span>
            </span>
            {!busy && (
              <button className="btn btn-ghost btn-small" onClick={() => setFile(null)} aria-label="Remove file">
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <span className="dropzone-icon">{Icons.upload}</span>
            <span className="dropzone-title">Drop a CSV file here, or click to choose</span>
            <span className="muted small">UTF-8 CSV up to {MAX_MB} MB · about 5,000 students is typical</span>
          </>
        )}
      </div>

      {state.kind === "uploading" && (
        <div className="progress" aria-live="polite">
          <div className="progress-bar" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          <span className="progress-label">Uploading… {Math.round(state.progress * 100)}%</span>
        </div>
      )}

      {state.kind === "error" && (
        <div className="callout callout-error" role="alert">
          {state.message}
        </div>
      )}

      {state.kind === "duplicate" && (
        <div className="callout callout-warn" role="alert">
          <div>
            <strong>Already imported.</strong> This exact file was imported on {dateTime(state.previous.createdAt)} as
            import #{state.previous.id} ({num(state.previous.accepted)} students in, {num(state.previous.rejected)} rows
            rejected). Importing it again will not change anyone.
          </div>
          <div className="callout-actions">
            <Link className="btn btn-small" to={`/import/${state.previous.id}`}>
              See that import
            </Link>
            <button className="btn btn-small btn-ghost" onClick={() => start(true)}>
              Import again anyway
            </button>
          </div>
        </div>
      )}

      <div className="upload-actions">
        <button className="btn btn-primary btn-large" disabled={!file || busy} onClick={() => start(false)}>
          {busy ? "Uploading…" : "Upload and check"}
        </button>
      </div>
    </section>
  );
}

function FileRules() {
  return (
    <details className="card rules">
      <summary>What the file needs to look like</summary>
      <div className="rules-body">
        <p>
          The first line must name these columns, in any order (extra columns, like a parent phone number, are
          ignored):
        </p>
        <table className="table compact">
          <tbody>
            <tr><td><code>student_id</code></td><td>3–20 letters, digits or hyphens. Not case-sensitive. The first row with an ID wins; later rows with the same ID are rejected.</td></tr>
            <tr><td><code>full_name</code></td><td>2–100 characters. Any language; apostrophes, commas and hyphens are fine.</td></tr>
            <tr><td><code>email</code></td><td>A real-looking email address.</td></tr>
            <tr><td><code>date_of_birth</code></td><td>YYYY-MM-DD or DD/MM/YYYY. The student must be 5 to 25 years old today.</td></tr>
            <tr><td><code>grade_level</code></td><td>A whole number from 1 to 12 (“09” is fine, “IX” is not).</td></tr>
            <tr><td><code>section</code></td><td>One letter, A to F.</td></tr>
            <tr><td><code>maths</code>, <code>science</code>, <code>english</code>, <code>social_studies</code>, <code>second_language</code></td><td>A number from 0 to 100. Decimals are fine.</td></tr>
          </tbody>
        </table>
        <p className="muted small">
          Blank lines are skipped. Uploading the same file twice is detected. If a student already exists, the newer
          file updates their marks.
        </p>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ detail

function ImportDetail({ id, onFinished }: { id: number; onFinished: () => void }) {
  const res = useApi<{ import: ImportInfo }>(`/api/imports/${id}`);
  const imp = res.data?.import;
  const running = imp?.status === "queued" || imp?.status === "processing";
  useInterval(res.reload, 400, running);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current && imp) {
      wasRunning.current = false;
      onFinished();
    }
  }, [running, imp, onFinished]);

  if (res.state === "error" && !imp) {
    if (res.error.status === 404) {
      return (
        <div className="card">
          <EmptyState icon="?" title={`There is no import #${id}`} action={<Link className="btn btn-primary" to="/import">Import a file</Link>} />
        </div>
      );
    }
    return <ErrorState error={res.error} onRetry={res.reload} />;
  }
  if (!imp) return <div className="card"><div className="skeleton" style={{ height: 120 }} /></div>;

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Import #{imp.id}</p>
        <h1 className="filename">{imp.fileName}</h1>
        <p className="muted">
          {bytes(imp.fileSize)} · uploaded {dateTime(imp.createdAt)}
          {imp.status === "completed" && imp.ignoredColumns.length > 0 && (
            <> · ignored column{imp.ignoredColumns.length > 1 ? "s" : ""} {imp.ignoredColumns.join(", ")}</>
          )}
        </p>
      </header>

      {running && <Running imp={imp} />}
      {imp.status === "failed" && <Failed imp={imp} />}
      {imp.status === "completed" && <Completed imp={imp} />}
    </>
  );
}

function Running({ imp }: { imp: ImportInfo }) {
  return (
    <section className="card" aria-live="polite">
      <h2>{imp.status === "queued" ? "Waiting for another import to finish…" : "Checking every row…"}</h2>
      <div className="progress progress-large">
        <div className="progress-bar animated" style={{ width: `${Math.max(3, Math.round(imp.progress * 100))}%` }} />
      </div>
      <p className="muted">
        {num(imp.rowsRead)} rows checked so far · {num(imp.accepted)} look good · {num(imp.rejected)} need attention
      </p>
      <p className="muted small">You can leave this page; the import keeps running and shows up under Recent imports.</p>
    </section>
  );
}

function Failed({ imp }: { imp: ImportInfo }) {
  return (
    <section className="card result-banner result-failed" role="alert">
      <span className="result-icon">{Icons.alert}</span>
      <div>
        <h2>We couldn’t import this file</h2>
        <p>{imp.errorMessage}</p>
        <p className="muted small">Nothing from this file was saved, so it is safe to fix it and upload it again.</p>
        <Link className="btn btn-primary" to="/import">
          Upload a corrected file
        </Link>
      </div>
    </section>
  );
}

function Completed({ imp }: { imp: ImportInfo }) {
  const [tab, setTab] = useState<"error" | "warning">("error");
  const [code, setCode] = useState<string | null>(null);
  const allGood = imp.rejected === 0;
  const byCode = Object.entries(imp.summary.byCode ?? {}).sort((a, b) => b[1] - a[1]);
  const byField = Object.entries(imp.summary.byField ?? {}).sort((a, b) => b[1] - a[1]);
  const maxCode = Math.max(1, ...byCode.map(([, n]) => n));
  const maxField = Math.max(1, ...byField.map(([, n]) => n));

  const changes = [
    imp.inserted && `${num(imp.inserted)} new`,
    imp.updated && `${num(imp.updated)} updated`,
    imp.unchanged && `${num(imp.unchanged)} unchanged`,
  ].filter(Boolean);

  return (
    <>
      <section className={`card result-banner ${allGood ? "result-ok" : "result-partial"}`}>
        <span className="result-icon">{allGood ? Icons.check : Icons.alert}</span>
        <div>
          <h2>
            {plural(imp.accepted, "student")} imported
            {allGood ? ". Every row was fine." : `, ${plural(imp.rejected, "row")} need fixing.`}
          </h2>
          <p className="muted">
            {changes.join(" · ") || "No students"}
            {imp.warnings > 0 && <> · {plural(imp.warnings, "row")} imported with a warning</>}
          </p>
          <div className="banner-actions">
            <Link className="btn btn-primary" to="/students">
              View students
            </Link>
            {imp.rejected > 0 && (
              <a className="btn" href={`/api/imports/${imp.id}/errors.csv`} download>
                {Icons.download} Download rejected rows (CSV)
              </a>
            )}
          </div>
        </div>
      </section>

      <div className="stat-grid">
        <Stat label="Rows read" value={imp.rowsRead} hint="Blank lines are not counted" />
        <Stat label="Imported" value={imp.accepted} tone="ok" />
        <Stat label="Rejected" value={imp.rejected} tone={imp.rejected ? "bad" : undefined} />
        <Stat label="Warnings" value={imp.warnings} tone={imp.warnings ? "warn" : undefined} hint="Imported, but worth a look" />
      </div>

      {imp.rejected > 0 && (
        <section className="card">
          <div className="breakdown">
            <div>
              <h3>Why rows were rejected</h3>
              <ul className="bars">
                {byCode.map(([c, n]) => (
                  <li key={c}>
                    <button
                      className={`bar-row${code === c && tab === "error" ? " selected" : ""}`}
                      onClick={() => {
                        setTab("error");
                        setCode(code === c ? null : c);
                      }}
                      title={CODE_LABELS[c]?.hint}
                    >
                      <span className="bar-label">{CODE_LABELS[c]?.label ?? c}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(n / maxCode) * 100}%` }} />
                      </span>
                      <span className="bar-value">{num(n)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">Click a reason to filter the table below.</p>
            </div>
            <div>
              <h3>Columns with problems</h3>
              <ul className="bars">
                {byField.map(([f, n]) => (
                  <li key={f}>
                    <div className="bar-row static">
                      <span className="bar-label">{FIELD_LABELS[f] ?? f}</span>
                      <span className="bar-track">
                        <span className="bar-fill alt" style={{ width: `${(n / maxField) * 100}%` }} />
                      </span>
                      <span className="bar-value">{num(n)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {(imp.rejected > 0 || imp.warnings > 0) && (
        <section className="card">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "error"} onClick={() => { setTab("error"); setCode(null); }}>
              Rejected rows <span className="count">{num(imp.rejected)}</span>
            </button>
            <button role="tab" aria-selected={tab === "warning"} onClick={() => { setTab("warning"); setCode(null); }}>
              Warnings <span className="count">{num(imp.warnings)}</span>
            </button>
            {code && (
              <button className="chip" onClick={() => setCode(null)}>
                {CODE_LABELS[code]?.label ?? code} ✕
              </button>
            )}
          </div>
          <IssuesTable importId={imp.id} severity={tab} code={code} />
        </section>
      )}
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: "ok" | "bad" | "warn"; hint?: string }) {
  return (
    <div className={`stat${tone ? " stat-" + tone : ""}`} title={hint}>
      <span className="stat-value">{num(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function IssuesTable({ importId, severity, code }: { importId: number; severity: "error" | "warning"; code: string | null }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [severity, code]);
  const qs = new URLSearchParams({ page: String(page), pageSize: "25", severity });
  if (code) qs.set("code", code);
  const res = useApi<{ total: number; page: number; pageSize: number; errors: RowIssue[] }>(
    `/api/imports/${importId}/errors?${qs}`,
  );

  if (res.state === "error") return <ErrorState error={res.error} onRetry={res.reload} />;
  const data = res.data;
  if (data && data.total === 0) {
    return <EmptyState title={severity === "warning" ? "No warnings" : "No rejected rows"} />;
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table issues">
          <thead>
            <tr>
              <th className="num">Line</th>
              <th>Student ID</th>
              <th>What to fix</th>
              <th>Row as it was in the file</th>
            </tr>
          </thead>
          <tbody className={res.state === "loading" ? "is-loading" : undefined}>
            {!data && <SkeletonRows rows={6} cols={4} />}
            {data?.errors.map((e) => (
              <tr key={`${e.line}-${e.code}`}>
                <td className="num mono">{e.line}</td>
                <td className="mono">
                  {severity === "warning" && e.studentId ? (
                    <Link to={`/students/${encodeURIComponent(e.studentId)}`}>{e.studentId}</Link>
                  ) : (
                    e.studentId ?? <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <ul className="problems">
                    {e.problems.map((p, i) => (
                      <li key={i}>
                        <span className={`code-tag code-${p.code}`}>{CODE_LABELS[p.code]?.label ?? p.code}</span>{" "}
                        {p.message}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  <code className="raw" title={e.raw}>
                    {e.raw || "(empty)"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          pages={Math.max(1, Math.ceil(data.total / data.pageSize))}
          onPage={setPage}
          noun="rows"
        />
      )}
    </>
  );
}

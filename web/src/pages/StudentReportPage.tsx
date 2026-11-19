import { Link, useLocation, useParams } from "react-router-dom";
import type { Grading, StudentReport } from "../api.ts";
import { BackLink, EmptyState, ErrorState, GradeBadge, Icons, ResultPill } from "../components/ui.tsx";
import { initials, longDate, mark, ordinal, pct } from "../format.ts";
import { useApi, useDocumentTitle } from "../hooks.ts";

export function StudentReportPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const back = `/students${from ? `?${from}` : ""}`;

  const res = useApi<StudentReport>(`/api/students/${encodeURIComponent(id)}`);
  const grading = useApi<Grading>("/api/grading");
  useDocumentTitle(res.data?.student.fullName ?? id);

  if (res.state === "error" && res.error.status === 404) {
    return (
      <>
        <BackLink to={back}>All students</BackLink>
        <div className="card">
          <EmptyState
            icon={Icons.search}
            title={`We couldn’t find student ${id.toUpperCase()}`}
            action={
              <>
                <Link className="btn btn-primary" to={`/students?q=${encodeURIComponent(id)}`}>
                  Search for “{id}”
                </Link>
                <Link className="btn" to="/import">
                  Import more results
                </Link>
              </>
            }
          >
            No imported student has this ID. It may be a typo, or the row may have been rejected during import.
          </EmptyState>
        </div>
      </>
    );
  }
  if (res.state === "error") {
    return (
      <>
        <BackLink to={back}>All students</BackLink>
        <ErrorState error={res.error} onRetry={res.reload} />
      </>
    );
  }
  if (!res.data) return <ReportSkeleton />;

  const { student: s, subjects, result: r, classContext: c } = res.data;
  const band = grading.data?.bands.find((b) => b.grade === r.grade);

  return (
    <>
      <div className="report-actions no-print">
        <BackLink to={back}>All students</BackLink>
        <button className="btn btn-small" onClick={() => window.print()}>
          Print report
        </button>
      </div>

      <article className="report">
        <section className="card report-head">
          <div className="avatar" aria-hidden>
            {initials(s.fullName)}
          </div>
          <div className="report-who">
            <h1>{s.fullName}</h1>
            <p className="muted">
              <span className="mono">{s.studentId}</span> · Grade {s.gradeLevel}, Section {s.section}
            </p>
            <dl className="facts">
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${s.email}`}>{s.email}</a>
                </dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>
                  {longDate(s.dateOfBirth)} <span className="muted">({s.age} years)</span>
                </dd>
              </div>
              <div>
                <dt>Class</dt>
                <dd>
                  {s.gradeLevel}-{s.section} · {c.size} students
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={`card overall ${r.passed ? "overall-pass" : "overall-fail"}`}>
          <Ring value={r.percentage} passed={r.passed} />
          <div className="overall-grid">
            <div>
              <span className="k">Total</span>
              <span className="v">
                {mark(r.total)} <small>/ {r.maxTotal}</small>
              </span>
            </div>
            <div>
              <span className="k">Grade</span>
              <span className="v">
                <GradeBadge grade={r.grade} size="lg" /> <small>{band?.label}</small>
              </span>
            </div>
            <div>
              <span className="k">Result</span>
              <span className="v">
                <ResultPill passed={r.passed} />
              </span>
            </div>
            <div>
              <span className="k">Rank in {s.gradeLevel}-{s.section}</span>
              <span className="v">
                {ordinal(c.rank)} <small>of {c.size}</small>
              </span>
            </div>
          </div>
          {!r.passed && (
            <p className="overall-note">
              Below the pass mark of {grading.data?.passMark ?? 33} in{" "}
              {subjects
                .filter((x) => !x.passed)
                .map((x) => x.label)
                .join(", ")}
              . A student must pass every subject to pass overall.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Marks</h2>
          <div className="table-wrap">
            <table className="table marks">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th className="num">Mark</th>
                  <th className="bar-col">
                    <span className="legend">
                      <i className="lg-mark" /> mark <i className="lg-avg" /> class average <i className="lg-pass" /> pass mark
                    </span>
                  </th>
                  <th>Grade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((x) => (
                  <tr key={x.key}>
                    <td>{x.label}</td>
                    <td className="num strong">{mark(x.mark)}</td>
                    <td className="bar-col">
                      <div className="track" aria-label={`${x.label}: ${x.mark} out of 100, class average ${x.classAverage}`}>
                        <span className={`fill${x.passed ? "" : " fail"}`} style={{ width: `${x.mark}%` }} />
                        <span className="avg" style={{ left: `${x.classAverage}%` }} title={`Class average ${x.classAverage}`} />
                        <span className="passline" style={{ left: `${grading.data?.passMark ?? 33}%` }} />
                      </div>
                    </td>
                    <td>
                      <GradeBadge grade={x.grade} />
                    </td>
                    <td>{x.passed ? <span className="ok-text">Passed</span> : <span className="fail-text">Below pass mark</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num strong">{mark(r.total)}</td>
                  <td className="muted">out of {r.maxTotal} · class average {pct(c.averagePercentage)}</td>
                  <td>
                    <GradeBadge grade={r.grade} />
                  </td>
                  <td>
                    <ResultPill passed={r.passed} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {grading.data && (
          <details className="card scheme">
            <summary>How grades are worked out</summary>
            <ul>
              {grading.data.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="bands">
              {grading.data.bands.map((b, i, all) => (
                <span key={b.grade} className={b.grade === r.grade ? "current" : undefined}>
                  <GradeBadge grade={b.grade} /> {b.min}
                  {i === 0 ? "–100" : `–${all[i - 1]!.min - 1}`}
                </span>
              ))}
            </div>
          </details>
        )}

        <p className="muted small source">
          From <Link to={`/import/${s.importId}`}>import #{s.importId}</Link>, line {s.sourceLine} of the file.
        </p>
      </article>
    </>
  );
}

function Ring({ value, passed }: { value: number; passed: boolean }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${value} percent`}>
      <svg viewBox="0 0 120 120" width="132" height="132">
        <circle cx="60" cy="60" r={r} className="ring-bg" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className={`ring-fg${passed ? "" : " fail"}`}
          strokeDasharray={`${(value / 100) * circ} ${circ}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <span className="ring-value">
        {pct(value)}
        <small>percentage</small>
      </span>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report">
      <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>
      <div className="card"><div className="skeleton" style={{ height: 140 }} /></div>
      <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
    </div>
  );
}

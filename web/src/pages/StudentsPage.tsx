import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Stats, StudentList } from "../api.ts";
import { EmptyState, ErrorState, GradeBadge, Icons, Pager, ResultPill, SkeletonRows } from "../components/ui.tsx";
import { num, pct } from "../format.ts";
import { useApi, useDebounced, useDocumentTitle } from "../hooks.ts";

const SECTIONS = ["A", "B", "C", "D", "E", "F"];

export function StudentsPage() {
  useDocumentTitle("Students");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const debounced = useDebounced(search, 250);
  const searchBox = useRef<HTMLInputElement>(null);

  const page = Number(params.get("page") ?? 1) || 1;
  const grade = params.get("grade") ?? "";
  const section = params.get("section") ?? "";
  const result = params.get("result") ?? "";
  const sort = params.get("sort") ?? "name";
  const dir = params.get("dir") ?? "asc";
  const pageSize = params.get("pageSize") ?? "25";

  // Every filter lives in the URL, so back/forward and shared links work.
  const update = (next: Record<string, string>, resetPage = true) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (resetPage) p.delete("page");
    setParams(p, { replace: "q" in next });
  };

  useEffect(() => {
    if (debounced !== q) update({ q: debounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // "/" jumps to search, like most admin tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const apiQs = new URLSearchParams({ page: String(page), pageSize, sort, dir });
  if (q) apiQs.set("q", q);
  if (grade) apiQs.set("grade", grade);
  if (section) apiQs.set("section", section);
  if (result) apiQs.set("result", result);
  const list = useApi<StudentList>(`/api/students?${apiQs}`);
  const stats = useApi<Stats>("/api/stats");

  const filtered = Boolean(q || grade || section || result);
  const data = list.data;
  const noStudentsAtAll = stats.data?.students === 0;

  const sortBy = (key: string) => {
    if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" });
    else update({ sort: key, dir: key === "percentage" ? "desc" : "asc" });
  };
  const sortMark = (key: string) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");
  const ariaSort = (key: string) => (sort === key ? (dir === "asc" ? "ascending" : "descending") : "none");

  if (noStudentsAtAll) {
    return (
      <div className="card">
        <EmptyState
          icon={Icons.people}
          title="No students yet"
          action={
            <Link className="btn btn-primary" to="/import">
              Import a results file
            </Link>
          }
        >
          Students show up here once you import a term results CSV.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <header className="page-head row">
        <div>
          <h1>Students</h1>
          {stats.data && (
            <p className="lead">
              {num(stats.data.students)} students · {pct(stats.data.students ? (stats.data.passed / stats.data.students) * 100 : 0)} passed
              {stats.data.averagePercentage !== null && <> · average {pct(stats.data.averagePercentage)}</>}
            </p>
          )}
        </div>
        {stats.data && <GradeSpark dist={stats.data.gradeDistribution} />}
      </header>

      <section className="card">
        <div className="toolbar">
          <label className="search">
            {Icons.search}
            <input
              ref={searchBox}
              type="search"
              placeholder="Search by name, ID or email   ( / )"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </label>
          <select value={grade} onChange={(e) => update({ grade: e.target.value })} aria-label="Grade">
            <option value="">All grades</option>
            {(stats.data?.gradeLevels ?? Array.from({ length: 12 }, (_, i) => i + 1)).map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
          <select value={section} onChange={(e) => update({ section: e.target.value })} aria-label="Section">
            <option value="">All sections</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                Section {s}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Result">
            {[
              ["", "All"],
              ["pass", "Passed"],
              ["fail", "Failed"],
            ].map(([v, label]) => (
              <button key={v} aria-pressed={result === v} onClick={() => update({ result: v! })}>
                {label}
              </button>
            ))}
          </div>
          {filtered && (
            <button
              className="btn btn-ghost btn-small"
              onClick={() => {
                setSearch("");
                setParams(new URLSearchParams());
              }}
            >
              Clear
            </button>
          )}
        </div>

        {list.state === "error" && <ErrorState error={list.error} onRetry={list.reload} />}

        <div className="table-wrap">
          <table className="table students">
            <thead>
              <tr>
                <th aria-sort={ariaSort("id")}>
                  <button onClick={() => sortBy("id")}>Student ID{sortMark("id")}</button>
                </th>
                <th aria-sort={ariaSort("name")}>
                  <button onClick={() => sortBy("name")}>Name{sortMark("name")}</button>
                </th>
                <th aria-sort={ariaSort("class")}>
                  <button onClick={() => sortBy("class")}>Class{sortMark("class")}</button>
                </th>
                <th aria-sort={ariaSort("percentage")} className="pct-col">
                  <button onClick={() => sortBy("percentage")}>Percentage{sortMark("percentage")}</button>
                </th>
                <th>Grade</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody className={list.state === "loading" && data ? "is-loading" : undefined}>
              {!data && list.state === "loading" && <SkeletonRows rows={10} cols={6} />}
              {data?.students.map((s) => (
                <tr
                  key={s.studentId}
                  className="clickable"
                  onClick={() => navigate(`/students/${encodeURIComponent(s.studentId)}`, { state: { from: params.toString() } })}
                >
                  <td className="mono">{s.studentId}</td>
                  <td>
                    <Link
                      to={`/students/${encodeURIComponent(s.studentId)}`}
                      state={{ from: params.toString() }}
                      onClick={(e) => e.stopPropagation()}
                      className="name-link"
                    >
                      {s.fullName}
                    </Link>
                    <span className="sub">{s.email}</span>
                  </td>
                  <td>
                    {s.gradeLevel}-{s.section}
                  </td>
                  <td className="pct-col">
                    <span className="pct-cell">
                      <span className="mini-bar">
                        <span style={{ width: `${s.percentage}%` }} className={s.passed ? "" : "fail"} />
                      </span>
                      <span className="num">{pct(s.percentage)}</span>
                    </span>
                  </td>
                  <td>
                    <GradeBadge grade={s.grade} />
                  </td>
                  <td>
                    <ResultPill passed={s.passed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total === 0 && (
          <EmptyState
            icon={Icons.search}
            title={q ? `No students match “${q}”` : "No students match these filters"}
            action={
              <button
                className="btn"
                onClick={() => {
                  setSearch("");
                  setParams(new URLSearchParams());
                }}
              >
                Clear search and filters
              </button>
            }
          >
            Search looks at names, IDs and emails. Accents don’t matter: “zoe” finds “Zoë”.
          </EmptyState>
        )}

        {data && (
          <div className="table-foot">
            <Pager
              page={data.page}
              pages={data.pages}
              total={data.total}
              pageSize={data.pageSize}
              onPage={(p) => update({ page: String(p) }, false)}
              noun="students"
            />
            <label className="muted small page-size">
              Rows per page{" "}
              <select value={pageSize} onChange={(e) => update({ pageSize: e.target.value })}>
                {["25", "50", "100"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>
    </>
  );
}

function GradeSpark({ dist }: { dist: Stats["gradeDistribution"] }) {
  const max = Math.max(1, ...dist.map((d) => d.count));
  return (
    <div className="spark" aria-label="Students per grade">
      {dist.map((d) => (
        <div key={d.grade} className="spark-col" title={`${d.grade}: ${num(d.count)} students`}>
          <span className="spark-bar" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
          <span className="spark-label">{d.grade}</span>
        </div>
      ))}
    </div>
  );
}

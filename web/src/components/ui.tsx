import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiError } from "../api.ts";

export function GradeBadge({ grade, size = "md" }: { grade: string; size?: "md" | "lg" }) {
  const tone = grade.startsWith("A") ? "a" : grade.startsWith("B") ? "b" : grade.startsWith("C") ? "c" : grade === "D" ? "d" : "e";
  return <span className={`grade grade-${tone} grade-${size}`}>{grade}</span>;
}

export function ResultPill({ passed }: { passed: boolean }) {
  return <span className={`pill ${passed ? "pill-pass" : "pill-fail"}`}>{passed ? "Pass" : "Fail"}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const label = { queued: "Waiting", processing: "Checking", completed: "Done", failed: "Failed" }[status] ?? status;
  return <span className={`pill pill-${status}`}>{label}</span>;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="callout callout-error" role="alert">
      <strong>Couldn’t load this.</strong> {error.message}
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <span className="skeleton" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Pager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  noun = "rows",
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  noun?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted">
        Showing <b>{from.toLocaleString("en-IN")}</b>–<b>{to.toLocaleString("en-IN")}</b> of{" "}
        <b>{total.toLocaleString("en-IN")}</b> {noun}
      </span>
      <div className="pager-buttons">
        <button className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          «
        </button>
        <button className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </button>
        <span className="pager-page">
          Page{" "}
          <input
            aria-label="Page number"
            type="number"
            min={1}
            max={pages}
            key={page}
            defaultValue={page}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Number((e.target as HTMLInputElement).value);
                if (n >= 1 && n <= pages) onPage(n);
              }
            }}
          />{" "}
          of {pages.toLocaleString("en-IN")}
        </span>
        <button className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next ›
        </button>
        <button
          className="btn btn-ghost btn-small"
          disabled={page >= pages}
          onClick={() => onPage(pages)}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </nav>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back-link" to={to}>
      ← {children}
    </Link>
  );
}

export const Icons = {
  upload: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  ),
};

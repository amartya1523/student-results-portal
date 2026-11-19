import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { Stats } from "./api.ts";
import { num } from "./format.ts";
import { useApi } from "./hooks.ts";
import { ImportPage } from "./pages/ImportPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { StudentReportPage } from "./pages/StudentReportPage.tsx";
import { StudentsPage } from "./pages/StudentsPage.tsx";

function Layout() {
  const location = useLocation();
  // Re-read the count after every navigation so it updates after an import.
  const stats = useApi<Stats>(`/api/stats?nav=${location.key}`);
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>
              Results <b>Portal</b>
            </span>
          </NavLink>
          <nav className="nav">
            <NavLink to="/import">Import</NavLink>
            <NavLink to="/students">Students</NavLink>
          </nav>
          <div className="topbar-meta">
            {stats.data && (
              <span title="Students in the portal">
                <b>{num(stats.data.students)}</b> students
              </span>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page">
        <Outlet />
      </main>
      <footer className="footer">Student Results Portal · term results, checked and explained</footer>
    </div>
  );
}

function Home() {
  const stats = useApi<Stats>("/api/stats");
  if (stats.state === "loading" && !stats.data) return null;
  // First visit with an empty database goes straight to importing.
  return <Navigate to={stats.data && stats.data.students > 0 ? "/students" : "/import"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="import/:id" element={<ImportPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="students/:id" element={<StudentReportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

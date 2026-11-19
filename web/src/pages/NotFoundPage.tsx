import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui.tsx";
import { useDocumentTitle } from "../hooks.ts";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="card">
      <EmptyState
        icon="?"
        title="This page doesn’t exist"
        action={
          <>
            <Link className="btn btn-primary" to="/students">
              Go to students
            </Link>
            <Link className="btn" to="/import">
              Import a file
            </Link>
          </>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}

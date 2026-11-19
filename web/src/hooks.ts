import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, get } from "./api.ts";

export type Loadable<T> =
  | { state: "loading"; data?: T }
  | { state: "error"; error: ApiError; data?: T }
  | { state: "ready"; data: T };

/**
 * GETs a path and re-fetches when it changes. Keeps the previous data while
 * loading so tables don't flash empty between pages.
 */
export function useApi<T>(path: string | null): Loadable<T> & { reload: () => void } {
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setResult((r) => ({ state: "loading", data: r.data }));
    get<T>(path, ctrl.signal).then(
      (data) => setResult({ state: "ready", data }),
      (error) => {
        if ((error as Error).name === "AbortError") return;
        setResult((r) => ({ state: "error", error: error as ApiError, data: r.data }));
      },
    );
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...result, reload };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Calls fn every `ms` while `active` is true. */
export function useInterval(fn: () => void, ms: number, active: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Student Results Portal` : "Student Results Portal";
  }, [title]);
}

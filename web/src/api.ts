/** Thin typed client for the portal API. */

export type ImportStatus = "queued" | "processing" | "completed" | "failed";

export interface ImportInfo {
  id: number;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  errorMessage: string | null;
  asOfDate: string;
  progress: number;
  rowsRead: number;
  accepted: number;
  rejected: number;
  warnings: number;
  inserted: number;
  updated: number;
  unchanged: number;
  summary: {
    byCode?: Record<string, number>;
    byField?: Record<string, number>;
    warningsByCode?: Record<string, number>;
  };
  ignoredColumns: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Problem {
  code: string;
  field: string | null;
  message: string;
}

export interface RowIssue {
  line: number;
  studentId: string | null;
  code: string;
  problems: Problem[];
  raw: string;
}

export interface StudentListItem {
  studentId: string;
  fullName: string;
  email: string;
  gradeLevel: number;
  section: string;
  total: number;
  percentage: number;
  grade: string;
  passed: boolean;
}

export interface StudentList {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  students: StudentListItem[];
}

export interface StudentReport {
  student: {
    studentId: string;
    fullName: string;
    email: string;
    dateOfBirth: string;
    age: number;
    gradeLevel: number;
    section: string;
    importId: number;
    sourceLine: number;
    updatedAt: string;
  };
  subjects: {
    key: string;
    label: string;
    mark: number;
    grade: string;
    passed: boolean;
    classAverage: number;
  }[];
  result: {
    total: number;
    maxTotal: number;
    percentage: number;
    grade: string;
    passed: boolean;
    failedSubjects: string[];
  };
  classContext: { size: number; rank: number; averagePercentage: number };
}

export interface Stats {
  students: number;
  passed: number;
  averagePercentage: number | null;
  gradeDistribution: { grade: string; count: number }[];
  gradeLevels: number[];
}

export interface Grading {
  passMark: number;
  maxPerSubject: number;
  bands: { grade: string; min: number; label: string }[];
  rules: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON, e.g. a proxy error page */
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "HTTP_" + res.status,
      err?.message ?? `The server answered with an error (${res.status}). Please try again.`,
      body,
    );
  }
  return body as T;
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check that it is running and try again.", null);
  }
  return parse<T>(res);
}

/** Upload with real progress events, which fetch() still cannot give us. */
export function uploadCsv(
  file: File,
  opts: { force?: boolean; onProgress?: (fraction: number) => void } = {},
): Promise<{ import: ImportInfo }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/imports${opts.force ? "?force=1" : ""}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "NETWORK", "The upload was interrupted. Check your connection and try again.", null));
    xhr.onload = () => {
      parse<{ import: ImportInfo }>(
        new Response(xhr.responseText, { status: xhr.status, headers: { "Content-Type": "application/json" } }),
      ).then(resolve, reject);
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

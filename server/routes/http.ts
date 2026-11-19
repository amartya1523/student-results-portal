export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function intParam(value: string, what: string): number {
  if (!/^\d{1,9}$/.test(value)) throw new HttpError(400, "BAD_REQUEST", `“${value}” is not a valid ${what}.`);
  return Number(value);
}

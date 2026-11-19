const nf = new Intl.NumberFormat("en-IN");

export const num = (n: number) => nf.format(n);

export const pct = (n: number) => `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;

export const mark = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n * 10 === Math.round(n * 10) ? 1 : 2));

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** Plain-language names for the error codes in the brief. */
export const CODE_LABELS: Record<string, { label: string; hint: string }> = {
  MISSING_REQUIRED: { label: "Missing value", hint: "A required cell was left empty." },
  INVALID_FORMAT: { label: "Unreadable value", hint: "Written in a way we cannot read, like “IX” or “N/A”." },
  OUT_OF_RANGE: { label: "Value out of range", hint: "Readable, but not possible, like a mark of 105." },
  DUPLICATE_ID: { label: "Duplicate student ID", hint: "The ID was already used earlier in the file." },
  WRONG_FIELD_COUNT: { label: "Broken row", hint: "Too many or too few columns, usually a stray comma." },
  SHARED_EMAIL: { label: "Shared email", hint: "Two different students use the same email." },
  NAME_CHANGED: { label: "Name changed", hint: "An existing ID now has a different name." },
};

export const FIELD_LABELS: Record<string, string> = {
  student_id: "Student ID",
  full_name: "Full name",
  email: "Email",
  date_of_birth: "Date of birth",
  grade_level: "Grade",
  section: "Section",
  maths: "Maths",
  science: "Science",
  english: "English",
  social_studies: "Social studies",
  second_language: "Second language",
  "(whole row)": "Whole row",
};

export function initials(name: string): string {
  const parts = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

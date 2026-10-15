// All business dates are stored as Postgres DATE (no time, no timezone).
// In JS they are Date objects at UTC midnight. The old app used "DD-MM-YYYY"
// strings, so both formats are accepted on input.

const IST_OFFSET_MIN = 330;

/** Parse "DD-MM-YYYY", "YYYY-MM-DD", Date or Firestore Timestamp → UTC-midnight Date (or null). */
export function toDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    // Firestore Timestamp → take the IST calendar day
    const d = value.toDate();
    const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  }
  if (typeof value === "object" && typeof value._seconds === "number") {
    return toDate({ toDate: () => new Date(value._seconds * 1000) });
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // DD-MM-YYYY
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD (or ISO)
  if (m) return valid(+m[1], +m[2], +m[3]);
  return null;
}

function valid(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCDate() === d ? dt : null;
}

/** Today's date in India as a UTC-midnight Date. */
export function todayIST() {
  return toDate({ toDate: () => new Date() });
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Date → "DD-MM-YYYY" (format used on PDFs / old UI) */
export function fmtDMY(date) {
  const d = toDate(date);
  if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

/** Date → "YYYY-MM-DD" */
export function fmtISO(date) {
  const d = toDate(date);
  return d ? d.toISOString().slice(0, 10) : "";
}

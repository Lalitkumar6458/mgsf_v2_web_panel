/**
 * Date helpers for PDFs / receipts.
 *
 * Closing dates come from several places and are not stored consistently —
 * "25-04-2025", "2025-04-25", "25-Apr, 2025", a Firestore Timestamp, or a raw
 * epoch number. These helpers parse all of those so lists can be sorted by real
 * chronological order instead of string order, and printed in one short format.
 *
 * Dependency-free on purpose: this module is imported by the server-side PDF
 * route, so it must not pull in firebase or any browser-only code.
 */

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse just about anything into a Date, or null when it is not a date. */
export const parseAnyDate = (value) => {
  if (value === null || value === undefined || value === '') return null;

  // Date / Firestore Timestamp ({ seconds } or .toDate())
  if (typeof value === 'object') {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
    const secs = value.seconds ?? value._seconds;
    if (typeof secs === 'number') return new Date(secs * 1000);
    return null;
  }

  // Epoch — seconds or milliseconds
  if (typeof value === 'number') {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  // 25-Apr, 2025 · 25 Apr 2025 · 25-April-2025
  let m = s.match(/^(\d{1,2})[\s\-/]*([A-Za-z]{3,})[,\s\-/]+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo !== undefined) return new Date(+m[3], mo, +m[1]);
  }

  // 2025-04-25
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // 25-04-2025 · 25/04/2025  (day first — this is how the app writes dates)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/** Date → "25-04-2025" (DD-MM-YYYY). Unparseable input is returned unchanged. */
export const formatShortDate = (value, fallback = '-') => {
  const d = parseAnyDate(value);
  if (!d) return value ? String(value) : fallback;
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
};

/**
 * Sort a list chronologically.
 *
 * - `direction`: 'asc' (oldest first, default) or 'desc'
 * - Rows with no usable date are pushed to the end
 * - Ties and undated rows keep their original relative order (stable)
 */
export const sortByDate = (list = [], getValue = (x) => x, direction = 'asc') => {
  const dir = direction === 'desc' ? -1 : 1;

  return [...list]
    .map((item, i) => {
      const d = parseAnyDate(getValue(item));
      return { item, i, t: d ? d.getTime() : null };
    })
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      if (a.t === b.t) return a.i - b.i;
      return (a.t - b.t) * dir;
    })
    .map((x) => x.item);
};

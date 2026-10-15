// Raw SQL rows come back snake_case; the API speaks camelCase.
const toCamel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function camel(row) {
  if (Array.isArray(row)) return row.map(camel);
  if (!row || typeof row !== "object" || row instanceof Date) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

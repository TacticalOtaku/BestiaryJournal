/** Keep stored/searchable names intact; templates escape each display segment. */
export function splitDisplayName(value) {
  const parts = String(value ?? "").split(/\s*\/\s*/).filter(Boolean);
  return parts.map((part, index) => index < parts.length - 1 ? `${part} /` : part);
}

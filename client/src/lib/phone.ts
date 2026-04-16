/** Strip to digits only for comparison and normalization. */
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Best-effort E.164 for US-heavy input; preserves leading + digit runs. */
export function toE164UsDefault(raw: string): string {
  const trimmed = raw.trim();
  const d = digitsOnly(trimmed);
  if (!d) return "";
  if (trimmed.startsWith("+")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 10) return `+${d}`;
  return `+${d}`;
}

export function displayPhone(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith("1")) {
    const r = d.slice(1);
    return `+1 (${r.slice(0, 3)}) ${r.slice(3, 6)}-${r.slice(6)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw.trim() || "—";
}

export function matchesPhoneSearch(query: string, phone: string | null | undefined): boolean {
  if (!phone) return false;
  const qd = digitsOnly(query);
  const pd = digitsOnly(phone);
  if (!qd) return true;
  return pd.includes(qd);
}

export function matchesNameSearch(query: string, name: string | null | undefined): boolean {
  if (!query.trim()) return true;
  if (!name) return false;
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

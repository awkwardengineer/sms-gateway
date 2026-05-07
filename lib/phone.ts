/** Normalize for comparison: trim spaces; ensure leading + for US-style numbers if needed. */
export function normalizeE164(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (!s.startsWith("+") && /^\d{10,15}$/.test(s)) {
    s = `+${s}`;
  }
  return s;
}

export function isAuthorizedSender(from: string | undefined, allowed: string | undefined): boolean {
  if (!allowed?.trim()) return false;
  return normalizeE164(from) === normalizeE164(allowed);
}

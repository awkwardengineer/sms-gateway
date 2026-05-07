import type { VercelRequest } from "@vercel/node";

/** Plivo posts application/x-www-form-urlencoded fields like From, To, Text. */
export function getPlivoForm(req: VercelRequest): Record<string, string> {
  const body = req.body;
  if (body == null) return {};

  if (typeof body === "string") {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries());
  }

  if (Buffer.isBuffer(body)) {
    const params = new URLSearchParams(body.toString("utf8"));
    return Object.fromEntries(params.entries());
  }

  if (typeof body === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (v == null) continue;
      out[k] = String(v);
    }
    return out;
  }

  return {};
}

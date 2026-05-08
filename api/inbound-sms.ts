/**
 * SMS / webhook traffic should hit this route with **HTTP POST** (form or JSON body).
 * **GET** is only a health check (`sms-gateway ok`).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { fetchCurrentWeatherForZip, formatWeatherText } from "../lib/weather";

const root = process.cwd();
if (existsSync(join(root, ".env"))) loadEnv({ path: join(root, ".env") });
if (existsSync(join(root, ".env.local"))) {
  loadEnv({ path: join(root, ".env.local"), override: true });
}

/** Message contains "weather" → Open-Meteo using WEATHER_ZIP. */
const WEATHER = /weather/i;

/** Read user message from JSON, urlencoded form, plain-text body, or parsed object. */
function getText(req: VercelRequest): string {
  const b = req.body;
  if (b == null) return "";
  if (typeof b === "object" && !Buffer.isBuffer(b)) {
    const o = b as Record<string, unknown>;
    const direct = String(
      o.message ?? o.text ?? o.body ?? o.Body ?? o.Text ?? o.sms ?? o.content ?? ""
    ).trim();
    if (direct) return direct;
    for (const v of Object.values(o)) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s.length > 0) return s;
    }
    return "";
  }
  const raw = Buffer.isBuffer(b) ? b.toString("utf8") : b;
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      return String(j.message ?? j.text ?? j.body ?? j.Body ?? "").trim();
    } catch {
      /* fall through */
    }
  }
  const p = new URLSearchParams(raw);
  const fromKeys = String(
    p.get("message") ??
      p.get("text") ??
      p.get("Body") ??
      p.get("Text") ??
      ""
  ).trim();
  if (fromKeys) return fromKeys;
  for (const [, v] of p) {
    const t = String(v).trim();
    if (t.length > 0) return t;
  }
  // Raw body is the message (e.g. Content-Type: text/plain, or Postman "raw")
  if (s.length > 0) return s;
  return "";
}

function logIncomingBody(req: VercelRequest) {
  const ct = req.headers["content-type"] ?? "";
  const b = req.body;
  if (b == null) {
    console.error("[inbound-sms] body: <empty>");
    return;
  }
  if (typeof b === "object" && !Buffer.isBuffer(b)) {
    console.error("[inbound-sms] body: object keys:", Object.keys(b as object).join(", "));
    console.error("[inbound-sms] body: object", JSON.stringify(b).slice(0, 500));
    return;
  }
  const raw = Buffer.isBuffer(b) ? b.toString("utf8") : b;
  console.error("[inbound-sms] body: type", typeof b, "content-type:", ct);
  console.error("[inbound-sms] body: raw snippet:", raw.slice(0, 500));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.error("[inbound-sms]", req.method, req.url ?? "");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  if (req.method === "GET") {
    res.status(200).send("sms-gateway ok");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  logIncomingBody(req);
  const text = getText(req);
  console.error("[inbound-sms] parsed text:", {
    len: text.length,
    weather: WEATHER.test(text),
    text: text.slice(0, 200),
  });

  let body = "hello world";

  if (WEATHER.test(text)) {
    const zip = process.env.WEATHER_ZIP?.trim();
    if (!zip) {
      body = "Set WEATHER_ZIP in .env";
      console.error("[inbound-sms] weather skipped: no WEATHER_ZIP");
    } else {
      try {
        body = formatWeatherText(await fetchCurrentWeatherForZip(zip));
        console.error("[inbound-sms] weather ok", zip);
      } catch (e) {
        body = "Weather unavailable.";
        console.error("[inbound-sms] weather error", e);
      }
    }
  } else {
    console.error("[inbound-sms] reply: hello");
  }

  console.error(
    "[inbound-sms] out",
    body.length > 80 ? `${body.slice(0, 80)}…` : body
  );
  res.status(200).send(body);
}

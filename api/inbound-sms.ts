/**
 * SMS / webhook traffic should hit this route with **HTTP POST** (form or JSON body).
 * **GET** is only a health check (`sms-gateway ok`).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  formatBusReply,
  nextBusMinutesFromNow,
} from "../lib/mbta";
import { fetchCurrentWeatherForZip, formatWeatherText } from "../lib/weather";

/** Vercel injects env vars; dotenv files are for local `vercel dev` only. */
function loadLocalEnvFiles() {
  if (process.env.VERCEL) return;
  try {
    const { existsSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const { config: loadEnv } = require("dotenv") as typeof import("dotenv");
    const root = process.cwd();
    if (existsSync(join(root, ".env"))) loadEnv({ path: join(root, ".env") });
    if (existsSync(join(root, ".env.local"))) {
      loadEnv({ path: join(root, ".env.local"), override: true });
    }
  } catch (e) {
    console.error("[inbound-sms] dotenv load skipped:", e);
  }
}
loadLocalEnvFiles();

const WEATHER = /weather/i;
const BUS = /\bbus\b/i;
const SCHOOL = /\bschool\b/i;
const HOME = /\bhome\b/i;

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
  const wantsSchool = BUS.test(text) && SCHOOL.test(text);
  const wantsHome = BUS.test(text) && HOME.test(text);
  console.error("[inbound-sms] parsed text:", {
    len: text.length,
    weather: WEATHER.test(text),
    busSchool: wantsSchool,
    busHome: wantsHome,
    text: text.slice(0, 200),
  });

  let body = "hello world";

  if (wantsSchool) {
    try {
      const mins = await nextBusMinutesFromNow({
        stopId: "2704",
        routeIds: ["89", "101"],
        headsignAnyOf: ["sullivan"],
        max: 4,
      });
      body = formatBusReply("bus to school", mins);
      console.error("[inbound-sms] mbta school ok", mins);
    } catch (e) {
      body = "Bus times unavailable.";
      console.error("[inbound-sms] mbta school error", e);
    }
  } else if (wantsHome) {
    try {
      const mins = await nextBusMinutesFromNow({
        stopId: "2721",
        routeIds: ["89", "101"],
        headsignAnyOf: ["davis", "clarendon", "malden"],
        max: 4,
      });
      body = formatBusReply("bus to home", mins);
      console.error("[inbound-sms] mbta home ok", mins);
    } catch (e) {
      body = "Bus times unavailable.";
      console.error("[inbound-sms] mbta home error", e);
    }
  } else if (WEATHER.test(text)) {
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

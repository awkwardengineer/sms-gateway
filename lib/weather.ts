/** WMO Weather interpretation codes (WW) — see https://open-meteo.com/en/docs */
export function wmoCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown conditions";
}

export type HourlyOutlookSlot = {
  timeIso: string;
  tempF: number;
  summary: string;
};

export type TomorrowSummary = {
  highF: number;
  lowF: number;
  /** Abbreviated condition label for SMS. */
  summary: string;
};

export type CurrentWeatherResult = {
  time: string;
  tempF: number;
  weatherCode: number;
  summary: string;
  lat: number;
  lon: number;
  zip?: string;
  placeLabel?: string;
  /** IANA zone from Open-Meteo (e.g. `America/New_York`) — real “now” vs model `time` slot. */
  timezone?: string;
  /** +3h / +6h / +9h / +12h from current time floored to the hour (hourly rows). */
  outlook?: HourlyOutlookSlot[];
  /** Next calendar day in that timezone (Open-Meteo daily). */
  tomorrow?: TomorrowSummary;
};

const US_ZIP_RE = /^(\d{5})(?:-(\d{4}))?$/;

export function parseUsZip(raw: string): { zip5: string; display: string } {
  const t = raw.trim();
  const m = t.match(US_ZIP_RE);
  if (!m) {
    throw new Error("WEATHER_ZIP must be a US ZIP (5 digits or ZIP+4)");
  }
  const zip5 = m[1];
  const display = m[2] ? `${zip5}-${m[2]}` : zip5;
  return { zip5, display };
}

export async function geocodeUsZip(zip5: string): Promise<{
  lat: number;
  lon: number;
  placeLabel: string;
}> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", zip5);
  url.searchParams.set("count", "1");
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("language", "en");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Geocoding HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      latitude: number;
      longitude: number;
      name?: string;
      admin1?: string;
    }>;
  };

  const first = data.results?.[0];
  if (
    !first ||
    typeof first.latitude !== "number" ||
    typeof first.longitude !== "number"
  ) {
    throw new Error(`No location found for ZIP ${zip5}`);
  }

  const placeLabel = [first.name, first.admin1].filter(Boolean).join(", ");
  return {
    lat: first.latitude,
    lon: first.longitude,
    placeLabel: placeLabel || zip5,
  };
}

/** `2026-05-08T07:15` → `2026-05-08T07:00` (start of the current local hour). */
function floorCurrentToHourIso(isoLocal: string): string {
  const m = isoLocal.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/);
  if (!m) return isoLocal;
  const hh = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${m[1]}T${hh}:00`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Add whole hours to a local `YYYY-MM-DDTHH:00` wall time (forecast location). */
function addHoursToFlooredLocal(flooredIso: string, hours: number): string {
  const m = flooredIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return flooredIso;
  let y = +m[1];
  let mo = +m[2];
  let d = +m[3];
  let h = +m[4] + hours;
  while (h >= 24) {
    h -= 24;
    d += 1;
    const dim = daysInMonth(y, mo);
    if (d > dim) {
      d = 1;
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:00`;
}

function findHourlyRow(
  times: string[],
  targetIso: string
): number {
  const norm = (s: string) => {
    const x = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/);
    if (!x) return s;
    return `${x[1]}T${String(+x[2]).padStart(2, "0")}:${x[3]}`;
  };
  const tNorm = norm(targetIso);
  const i = times.findIndex((row) => norm(row) === tNorm);
  if (i !== -1) return i;
  return times.findIndex((row) => row >= targetIso);
}

/** Today's date `YYYY-MM-DD` in `timeZone`. */
function localDateYmdNow(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Next calendar day `YYYY-MM-DD` in `timeZone`. */
function tomorrowYmdInZone(timeZone: string): string {
  const today = localDateYmdNow(timeZone);
  const [y, m, d] = today.split("-").map(Number);
  let dd = d + 1;
  let mm = m;
  let yy = y;
  const dim = daysInMonth(yy, mm);
  if (dd > dim) {
    dd = 1;
    mm += 1;
    if (mm > 12) {
      mm = 1;
      yy += 1;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}

/** Short labels for daily line (tmrw: …). */
function abbrevDayCondition(full: string): string {
  const x = full.toLowerCase();
  const map: Record<string, string> = {
    clear: "clear",
    "mainly clear": "main clr",
    "partly cloudy": "pt cldy",
    overcast: "ovcst",
    fog: "fog",
    drizzle: "drzl",
    "freezing drizzle": "frz drzl",
    rain: "rain",
    "freezing rain": "frz rain",
    snow: "snow",
    "rain showers": "rn shwr",
    "snow showers": "sn shwr",
    thunderstorm: "t-storm",
    "unknown conditions": "unk",
  };
  return map[x] ?? (x.length > 14 ? `${x.slice(0, 12)}..` : x);
}

function buildTomorrowFromDaily(
  timeZone: string | undefined,
  daily: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    weather_code: (number | null)[];
  }
): TomorrowSummary | undefined {
  if (!timeZone?.length) return undefined;
  const target = tomorrowYmdInZone(timeZone);
  const idx = daily.time.indexOf(target);
  if (idx === -1) return undefined;
  const hi = daily.temperature_2m_max[idx];
  const lo = daily.temperature_2m_min[idx];
  const code = daily.weather_code[idx];
  if (typeof hi !== "number" || typeof lo !== "number" || typeof code !== "number") {
    return undefined;
  }
  return {
    highF: Math.round(hi),
    lowF: Math.round(lo),
    summary: abbrevDayCondition(wmoCodeLabel(code)),
  };
}

/** Current local wall time floored to the hour, as `YYYY-MM-DDTHH:00` in `timeZone`. */
function flooredLocalHourIsoNow(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = parseInt(get("hour"), 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${mo}-${d}T${pad(h)}:00`;
}

/** Actual clock in the forecast location (not Open-Meteo’s 15‑minute `current.time` slot). */
function formatRealLocalNow12h(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date())
    .toLowerCase();
}

function buildOutlookFromHourly(
  flooredLocalHourIso: string,
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    weather_code: (number | null)[];
  }
): HourlyOutlookSlot[] {
  const times = hourly.time;
  if (!times?.length) return [];

  const floored = flooredLocalHourIso;
  const out: HourlyOutlookSlot[] = [];

  for (const off of [3, 6, 9, 12]) {
    const targetIso = addHoursToFlooredLocal(floored, off);
    const idx = findHourlyRow(times, targetIso);
    if (idx === -1 || idx >= times.length) continue;
    const code = hourly.weather_code[idx];
    const temp = hourly.temperature_2m[idx];
    if (typeof code !== "number" || typeof temp !== "number") continue;
    out.push({
      timeIso: times[idx],
      tempF: temp,
      summary: wmoCodeLabel(code),
    });
  }
  return out;
}

export async function fetchCurrentWeather(
  lat: number,
  lon: number
): Promise<CurrentWeatherResult> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("hourly", "temperature_2m,weather_code");
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,weather_code"
  );
  url.searchParams.set("forecast_hours", "48");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    timezone?: string;
    current?: { time?: string; temperature_2m?: number; weather_code?: number };
    hourly?: {
      time: string[];
      temperature_2m: (number | null)[];
      weather_code: (number | null)[];
    };
    daily?: {
      time: string[];
      temperature_2m_max: (number | null)[];
      temperature_2m_min: (number | null)[];
      weather_code: (number | null)[];
    };
  };

  const cur = data.current;
  if (
    !cur?.time ||
    typeof cur.temperature_2m !== "number" ||
    typeof cur.weather_code !== "number"
  ) {
    throw new Error("Open-Meteo response missing current weather fields");
  }

  const tz = data.timezone?.trim();
  const weatherCode = cur.weather_code;
  const flooredForOutlook =
    tz && tz.length > 0
      ? flooredLocalHourIsoNow(tz)
      : floorCurrentToHourIso(cur.time);
  const outlook =
    data.hourly?.time?.length
      ? buildOutlookFromHourly(flooredForOutlook, data.hourly)
      : [];

  const tomorrow =
    data.daily?.time?.length && tz
      ? buildTomorrowFromDaily(tz, data.daily)
      : undefined;

  return {
    time: cur.time,
    tempF: cur.temperature_2m,
    weatherCode,
    summary: wmoCodeLabel(weatherCode),
    lat,
    lon,
    timezone: tz,
    outlook,
    tomorrow,
  };
}

export async function fetchCurrentWeatherForZip(
  rawZip: string
): Promise<CurrentWeatherResult> {
  const { zip5, display } = parseUsZip(rawZip);
  const { lat, lon, placeLabel } = await geocodeUsZip(zip5);
  const weather = await fetchCurrentWeather(lat, lon);
  return {
    ...weather,
    zip: display,
    placeLabel,
  };
}

/**
 * Open-Meteo `current.time` is wall time at the forecast location (e.g. `2026-05-08T15:00`).
 */
function formatLocalTime12h(isoLocal: string): string {
  const m = isoLocal.match(/T(\d{1,2}):(\d{2})/);
  if (!m) return isoLocal;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${suffix}`;
}

/** e.g. `6pm`, `10am` (no `:00`, no space before am/pm). Non-zero minutes → `7:15pm`. */
function formatOutlookTime12h(isoLocal: string): string {
  const m = isoLocal.match(/T(\d{1,2}):(\d{2})/);
  if (!m) return isoLocal;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  if (min === "00") {
    return `${h}${suffix}`;
  }
  return `${h}:${min}${suffix}`;
}

/** Plain-text / SMS: time - ZIP, rule line, nowcast, then +3h/+6h/+9h/+12h outlook. */
export function formatWeatherText(w: CurrentWeatherResult): string {
  const zip = w.zip ?? "";
  const nowLabel =
    w.timezone && w.timezone.length > 0
      ? formatRealLocalNow12h(w.timezone)
      : formatLocalTime12h(w.time);
  const line1 = `${nowLabel} - ${zip}`;
  const rule = "===============";
  const t = Math.round(w.tempF);
  const line3 = `${t}, ${w.summary.toLowerCase()}`;
  const lines = [line1, rule, line3];
  if (w.outlook?.length) {
    lines.push("");
    for (const s of w.outlook) {
      const tt = Math.round(s.tempF);
      lines.push(
        `${formatOutlookTime12h(s.timeIso)}: ${tt}, ${s.summary.toLowerCase()}`
      );
    }
  }
  if (w.tomorrow) {
    const tm = w.tomorrow;
    lines.push("");
    lines.push(`tmrw: ${tm.highF}/${tm.lowF}, ${tm.summary}`);
  }
  return lines.join("\n");
}

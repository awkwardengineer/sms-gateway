/** WMO Weather interpretation codes (WW) — subset; see https://open-meteo.com/en/docs */
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

export type CurrentWeatherResult = {
  time: string;
  tempF: number;
  weatherCode: number;
  summary: string;
  lat: number;
  lon: number;
  /** Set when location came from WEATHER_ZIP */
  zip?: string;
  placeLabel?: string;
};

const US_ZIP_RE = /^(\d{5})(?:-(\d{4}))?$/;

/** Normalize env ZIP to 5-digit form for Open-Meteo geocoding search. */
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

export async function fetchCurrentWeather(
  lat: number,
  lon: number
): Promise<CurrentWeatherResult> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    current?: { time?: string; temperature_2m?: number; weather_code?: number };
  };

  const cur = data.current;
  if (
    !cur?.time ||
    typeof cur.temperature_2m !== "number" ||
    typeof cur.weather_code !== "number"
  ) {
    throw new Error("Open-Meteo response missing current weather fields");
  }

  const weatherCode = cur.weather_code;
  return {
    time: cur.time,
    tempF: cur.temperature_2m,
    weatherCode,
    summary: wmoCodeLabel(weatherCode),
    lat,
    lon,
  };
}

/** Resolve WEATHER_ZIP → coordinates, then current conditions. */
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

export function formatWeatherSms(w: CurrentWeatherResult): string {
  const t = Math.round(w.tempF);
  const where = w.placeLabel ? ` — ${w.placeLabel}` : w.zip ? ` — ${w.zip}` : "";
  return `${t}°F, ${w.summary.toLowerCase()} (as of ${w.time})${where}`;
}

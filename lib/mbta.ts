/** MBTA V3 JSON:API — https://www.mbta.com/developers/v3-api */

type JsonApiResource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data?: { id: string; type: string } | null }
  >;
};

type PredictionsResponse = {
  data: JsonApiResource[];
  included?: JsonApiResource[];
};

function resourceKey(r: { type: string; id: string }): string {
  return `${r.type}:${r.id}`;
}

function buildIncludedMap(included: JsonApiResource[] | undefined): Map<string, JsonApiResource> {
  const m = new Map<string, JsonApiResource>();
  if (!included) return m;
  for (const r of included) {
    m.set(resourceKey(r), r);
  }
  return m;
}

function tripHeadsign(
  tripId: string | undefined,
  included: Map<string, JsonApiResource>
): string {
  if (!tripId) return "";
  const trip = included.get(`trip:${tripId}`);
  const h = trip?.attributes?.headsign;
  return typeof h === "string" ? h : "";
}

function predictionDepartureIso(p: JsonApiResource): string | null {
  const dep = p.attributes?.departure_time;
  const arr = p.attributes?.arrival_time;
  if (typeof dep === "string" && dep) return dep;
  if (typeof arr === "string" && arr) return arr;
  return null;
}

export type NextBusQuery = {
  stopId: string;
  /** MBTA route ids, e.g. "89", "101" */
  routeIds: string[];
  /** Keep prediction if headsign matches any (case-insensitive substring). */
  headsignAnyOf: string[];
  max: number;
};

/**
 * Next departure minutes from now for matching routes + headsigns at one stop.
 * Optional `MBTA_API_KEY` header for higher rate limits.
 */
export async function nextBusMinutesFromNow(q: NextBusQuery): Promise<number[]> {
  const url = new URL("https://api-v3.mbta.com/predictions");
  url.searchParams.set("filter[stop]", q.stopId);
  url.searchParams.set("include", "trip,route");
  url.searchParams.set("page[limit]", "50");

  const headers: Record<string, string> = {};
  const key = process.env.MBTA_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`MBTA predictions HTTP ${res.status}`);
  }

  const json = (await res.json()) as PredictionsResponse;
  const included = buildIncludedMap(json.included);
  const routeSet = new Set(q.routeIds);
  const headLower = q.headsignAnyOf.map((s) => s.toLowerCase());

  const now = Date.now();
  type Row = { t: number; iso: string };
  const rows: Row[] = [];

  for (const p of json.data ?? []) {
    if (p.type !== "prediction") continue;
    const routeId = p.relationships?.route?.data?.id;
    if (!routeId || !routeSet.has(routeId)) continue;
    const tripId = p.relationships?.trip?.data?.id;
    const head = tripHeadsign(tripId, included);
    const hl = head.toLowerCase();
    if (!headLower.some((frag) => hl.includes(frag))) continue;
    const iso = predictionDepartureIso(p);
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t <= now) continue;
    rows.push({ t, iso });
  }

  rows.sort((a, b) => a.t - b.t);

  const minutes: number[] = [];
  const seenIso = new Set<string>();
  for (const { t, iso } of rows) {
    if (seenIso.has(iso)) continue;
    seenIso.add(iso);
    const m = Math.floor((t - now) / 60_000);
    minutes.push(m);
    if (minutes.length >= q.max) break;
  }

  return minutes;
}

export function formatBusReply(title: "bus to school" | "bus to home", minutes: number[]): string {
  const rule = "===============";
  if (minutes.length === 0) {
    return `${title}\n${rule}\nbus: no predictions`;
  }
  const list = minutes.join(",");
  return `${title}\n${rule}\n${list} min`;
}

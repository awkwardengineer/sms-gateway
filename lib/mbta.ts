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

type StopResponse = {
  data?: JsonApiResource;
};

const RULE = "===============";

function mbtaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = process.env.MBTA_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

async function mbtaFetch(url: URL): Promise<Response> {
  return fetch(url.toString(), { headers: mbtaHeaders() });
}

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

function predictionDirectionId(
  p: JsonApiResource,
  tripId: string | undefined,
  included: Map<string, JsonApiResource>
): number | undefined {
  const d = p.attributes?.direction_id;
  if (typeof d === "number") return d;
  if (!tripId) return undefined;
  const trip = included.get(`trip:${tripId}`);
  const td = trip?.attributes?.direction_id;
  return typeof td === "number" ? td : undefined;
}

function routeDirectionLabel(
  routeId: string | undefined,
  tripId: string | undefined,
  directionId: number | undefined,
  included: Map<string, JsonApiResource>
): string {
  const head = tripHeadsign(tripId, included);
  if (head) return head;
  if (!routeId || directionId === undefined) return "";
  const route = included.get(`route:${routeId}`);
  const dests = route?.attributes?.direction_destinations;
  if (Array.isArray(dests) && dests[directionId] != null) {
    return String(dests[directionId]);
  }
  const names = route?.attributes?.direction_names;
  if (Array.isArray(names) && names[directionId] != null) {
    return String(names[directionId]);
  }
  return "";
}

function routeShortName(
  routeId: string | undefined,
  included: Map<string, JsonApiResource>
): string {
  if (!routeId) return "";
  const route = included.get(`route:${routeId}`);
  const short = route?.attributes?.short_name;
  if (typeof short === "string" && short) return short;
  return routeId;
}

function predictionDepartureIso(p: JsonApiResource): string | null {
  const dep = p.attributes?.departure_time;
  const arr = p.attributes?.arrival_time;
  if (typeof dep === "string" && dep) return dep;
  if (typeof arr === "string" && arr) return arr;
  return null;
}

async function fetchPredictionsAtStop(stopId: string): Promise<PredictionsResponse> {
  const url = new URL("https://api-v3.mbta.com/predictions");
  url.searchParams.set("filter[stop]", stopId);
  url.searchParams.set("include", "trip,route");
  url.searchParams.set("page[limit]", "50");

  const res = await mbtaFetch(url);
  if (!res.ok) {
    throw new Error(`MBTA predictions HTTP ${res.status}`);
  }
  return (await res.json()) as PredictionsResponse;
}

export type MbtaStopParse =
  | { type: "none" }
  | { type: "invalid" }
  | { type: "ok"; stopNumber: string };

/** Parse `MBTA 1234` (stop number) from inbound SMS text. */
export function parseMbtaStopQuery(text: string): MbtaStopParse {
  if (!/\bMBTA\b/i.test(text)) return { type: "none" };
  const m = text.match(/\bMBTA\s+(\d{1,6})\b/i);
  if (!m) return { type: "invalid" };
  return { type: "ok", stopNumber: m[1] };
}

export type StopArrival = {
  route: string;
  direction: string;
  minutes: number;
};

async function fetchStop(stopId: string): Promise<{ id: string; name: string } | null> {
  const url = new URL(`https://api-v3.mbta.com/stops/${encodeURIComponent(stopId)}`);
  const res = await mbtaFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`MBTA stops HTTP ${res.status}`);
  }
  const json = (await res.json()) as StopResponse;
  const name = json.data?.attributes?.name;
  if (typeof name !== "string" || !json.data?.id) return null;
  return { id: json.data.id, name };
}

/**
 * Next arrivals at a stop: route number, direction/headsign, minutes from now.
 */
export async function nextBusArrivalsAtStop(
  stopId: string,
  max: number
): Promise<StopArrival[]> {
  const json = await fetchPredictionsAtStop(stopId);
  const included = buildIncludedMap(json.included);
  const now = Date.now();

  type Row = { t: number; iso: string; route: string; direction: string };
  const rows: Row[] = [];

  for (const p of json.data ?? []) {
    if (p.type !== "prediction") continue;
    const routeId = p.relationships?.route?.data?.id;
    const tripId = p.relationships?.trip?.data?.id;
    const iso = predictionDepartureIso(p);
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t <= now) continue;
    const directionId = predictionDirectionId(p, tripId, included);
    rows.push({
      t,
      iso,
      route: routeShortName(routeId, included),
      direction: routeDirectionLabel(routeId, tripId, directionId, included),
    });
  }

  rows.sort((a, b) => a.t - b.t);

  const arrivals: StopArrival[] = [];
  const seen = new Set<string>();
  for (const { t, iso, route, direction } of rows) {
    if (seen.has(iso)) continue;
    seen.add(iso);
    arrivals.push({
      route,
      direction,
      minutes: Math.floor((t - now) / 60_000),
    });
    if (arrivals.length >= max) break;
  }

  return arrivals;
}

export function formatMbtaStopReply(
  stopNumber: string,
  stopName: string,
  arrivals: StopArrival[]
): string {
  const header = `MBTA ${stopNumber}`;
  if (arrivals.length === 0) {
    return `${header}\n${RULE}\n${stopName}\nno predictions`;
  }
  const lines = arrivals.map((a) => {
    const dir = a.direction ? ` ${a.direction}` : "";
    return `${a.route}${dir} ${a.minutes} min`;
  });
  return `${header}\n${RULE}\n${stopName}\n${lines.join("\n")}`;
}

/** Lookup stop by number and return formatted SMS, or a user-facing error. */
export async function replyForMbtaStop(stopNumber: string): Promise<string> {
  try {
    const stop = await fetchStop(stopNumber);
    if (!stop) return `MBTA stop ${stopNumber} not found.`;
    const arrivals = await nextBusArrivalsAtStop(stop.id, 8);
    return formatMbtaStopReply(stopNumber, stop.name, arrivals);
  } catch {
    return "MBTA unavailable.";
  }
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
  const json = await fetchPredictionsAtStop(q.stopId);
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
  if (minutes.length === 0) {
    return `${title}\n${RULE}\nbus: no predictions`;
  }
  const list = minutes.join(", ");
  return `${title}\n${RULE}\n${list} min`;
}

/** Open Emoji API — https://emoji-api.com/ */

const MAX_RESULTS = 8;

export type EmojiHit = {
  character: string;
};

export type EmojiQueryParse =
  | { type: "none" }
  | { type: "invalid" }
  | { type: "ok"; search: string };

type EmojiApiRow = {
  character?: unknown;
};

/** Parse `👀 search term` from inbound SMS text. */
export function parseEmojiQuery(text: string): EmojiQueryParse {
  const idx = text.indexOf("👀");
  if (idx === -1) return { type: "none" };
  const search = text.slice(idx + "👀".length).trim();
  if (!search) return { type: "invalid" };
  return { type: "ok", search };
}

export async function searchEmojis(query: string): Promise<EmojiHit[]> {
  const key = process.env.EMOJI_KEY?.trim();
  if (!key) {
    throw new Error("EMOJI_KEY is not set");
  }

  const url = new URL("https://emoji-api.com/emojis");
  url.searchParams.set("search", query);
  url.searchParams.set("access_key", key);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Emoji API HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Emoji API unexpected response");
  }

  const hits: EmojiHit[] = [];
  for (const row of data as EmojiApiRow[]) {
    if (typeof row.character !== "string" || !row.character) continue;
    hits.push({ character: row.character });
    if (hits.length >= MAX_RESULTS) break;
  }
  return hits;
}

export function formatEmojiSearchText(hits: EmojiHit[]): string {
  if (hits.length === 0) return "no matches";
  return hits.map((h) => h.character).join("");
}

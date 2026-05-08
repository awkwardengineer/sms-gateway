# SMS Gateway — Project Plan

## Goal

A small personal SMS gateway: an HTTP POST webhook runs your logic and returns a **plain-text** body. **Now:** **`hello world`** by default; if **`Text`** contains the word **`weather`**, return **current conditions** from [Open-Meteo](https://open-meteo.com/) for **`WEATHER_ZIP`**. **Later:** MBTA, auth again if needed.

## Stack

| Piece     | Choice                                                                 |
| --------- | ---------------------------------------------------------------------- |
| Runtime   | Node.js (Vercel serverless-friendly)                                   |
| SMS       | Any provider that can POST form fields (e.g. `From`, `To`, `Text`)   |
| Weather   | [Open-Meteo](https://open-meteo.com/) (ZIP → geocode + forecast)       |
| Hosting   | Vercel serverless function(s)                                          |
| Local dev | `vercel dev` + [ngrok](https://ngrok.com/) (or similar)               |

## Request / response flow

1. Inbound message hits your provider; they POST to your URL (`application/x-www-form-urlencoded` is typical).
2. Handler reads `From` / `To` / `Text` when present (for logging and routing).
3. **200** + **`Content-Type: text/plain; charset=utf-8`** + body **`hello world`**, or a **weather** line if `Text` contains the word **weather** (case-insensitive) and **`WEATHER_ZIP`** is set.

*(Your provider must define what the response body means for auto-replies—many expect XML or their own format; this repo is intentionally plain text until you wire a specific provider again.)*

## Configuration

- **`WEATHER_ZIP`:** US 5-digit or ZIP+4; used when the message includes “weather”. See `.env.example`.

Optional later: webhook signature validation, rate limits, minimal PII in logs.

---

## Milestone 1 — Webhook + weather

**Done when:**

- **POST** → **200** + plain text **`hello world`** (default).
- **POST** with **`weather`** in `Text` → **200** + short current weather for **`WEATHER_ZIP`** (Open-Meteo).

---

## Future (backlog)

- **MBTA** or other intents.
- **Deploy:** production URL on Vercel; update provider webhook URL.
- **Hardening:** env in Vercel, logging discipline.

---

## Implementation notes

- Route: **`/api/inbound-sms`**
- Local env: **`.env.local`** (loaded via `dotenv` for `vercel dev`).

---

*Last updated: 2026-05-07*

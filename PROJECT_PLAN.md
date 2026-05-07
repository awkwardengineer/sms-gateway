# SMS Gateway (Plivo) — Project Plan

## Goal

A small personal SMS gateway: Plivo sends an HTTP POST to our endpoint; we run logic and return a text response. **Phase 1:** weather queries. **Later:** MBTA schedule (and similar tools).

## Stack


| Piece     | Choice                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| Runtime   | Node.js (Vercel serverless-friendly)                                                 |
| SMS       | [Plivo](https://www.plivo.com/docs/messaging/) inbound SMS → HTTP POST               |
| Weather   | [Open-Meteo](https://open-meteo.com/) (no API key for basic use)                     |
| Hosting   | Vercel serverless function(s)                                                        |
| Local dev | `vercel dev` + [ngrok](https://ngrok.com/) (or similar) so Plivo can reach localhost |


## Request / response flow

1. User texts your Plivo number.
2. Plivo POSTs to your URL (typically `application/x-www-form-urlencoded` with fields like `From`, `To`, `Text`, `MessageUUID`, etc.).
3. Handler validates (at least “is this my number?” in M1), runs intent logic (weather regex in M2/M3).
4. Response is **Plivo XML** (e.g. `<Response><Message>...</Message></Response>`) so Plivo can reply via SMS.

## Configuration (to add when implementing)

- **Your phone number(s):** E.164 format for whitelist checks (e.g. `+1...`).
- **Plivo:** Application / number URL pointing to the deployed (or ngrok) endpoint.
- **Weather:** `WEATHER_ZIP` (US 5-digit or ZIP+4); coordinates resolved via Open-Meteo geocoding, then forecast API.

Optional later: Plivo request signature validation, rate limits, logging.

---

## Milestone 1 — “Hello world” for your number only

**Done when:**

- Endpoint accepts Plivo’s POST.
- If `From` matches your configured number → respond with SMS body **“hello world”** (via Plivo XML).
- Otherwise → safe fallback (e.g. empty reply, or short “unauthorized” — your choice when implementing).

**Out of scope for M1:** Open-Meteo, regex routing.

---

## Milestone 2 — Weather intent → Open-Meteo → console

**Done when:**

- If inbound `Text` matches a **regex** for “weather” (case-insensitive or as you define), call Open-Meteo for current conditions (or forecast — pick one and document in code).
- **Log the useful result to the console** (structured enough to verify: temp, conditions, time, etc.).
- Still OK to return a stub SMS in M2 (e.g. same hello path) as long as weather path hits the API and logs.

**Out of scope for M2:** Polished user-facing SMS copy from weather data.

---

## Milestone 3 — Return weather as the SMS reply

**Done when:**

- When the weather regex matches and Open-Meteo succeeds → **return a concise SMS** in the Plivo `<Message>` body (length-friendly for SMS).
- On API failure or bad data → short error or fallback message (no stack traces to the user).

---

## Future (backlog)

- **MBTA:** Similar pattern — regex / keyword → fetch schedule API → reply.
- **Deploy:** Production URL on Vercel; update Plivo app URL; remove or rotate ngrok.
- **Hardening:** Signature validation, secrets in Vercel env, minimal PII in logs.

---

## Suggested implementation order (after this plan)

1. Scaffold Vercel serverless route (single `api/...` handler).
2. Parse Plivo POST body; build XML response helper.
3. Implement M1 → test with Plivo + ngrok.
4. Add Open-Meteo client + M2 logging.
5. Wire M3 SMS text + error handling.

---

*Last updated: 2026-05-07*
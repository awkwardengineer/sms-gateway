# Davis bus keywords — Design

**Date:** 2026-07-13  
**Status:** Approved for implementation planning

## Goal

Add SMS keywords for trips toward Davis Square / Clarendon Hill, and for getting home from Davis Square, without changing existing `school`, `home`, `MBTA`, or `weather` behavior (except keyword precedence when “davis” and “home” appear together).

## Approach

Extend the existing handler pattern in `api/inbound-sms.ts`: additional `if` branches that call `nextBusMinutesFromNow` and format titled blocks. Prefer this over a keyword config layer — only two new intents, and school/home already work this way.

## Keywords

| Intent | Match (case-insensitive) | Notes |
|--------|--------------------------|--------|
| Davis → home | Message contains both `davis` and `home` (covers `davis to home`, `davis home`, `home from davis`, etc.) | Higher priority than bare `home` or bare `davis` |
| Davis outbound | Word `davis` present, and not a Davis→home match | Does not require the message to be *only* `davis`, but must not also match home |
| Existing `home` | Word `home`, and not Davis→home | Unchanged query (stop 2721) |

### Precedence (handler order)

1. `MBTA` stop parse (invalid / ok) — unchanged  
2. Davis → home  
3. `school` — unchanged  
4. Bare `home` — unchanged  
5. Bare `davis` (outbound)  
6. `weather` — unchanged  
7. Default `hello world`

## Queries

### Outbound `davis` — stop **2729** (Broadway @ Main St)

Two separate lists (Clarendon Hill buses do not go all the way to Davis Square):

| Section title | Route | Headsign filter |
|---------------|-------|-----------------|
| `89 to Davis` | `89` | substring `davis` |
| `89 to Clarendon` | `89` | substring `clarendon` |

Up to **4** times per section (same as school/home).

### Davis → home — always both sections

| Section title | Stop | Routes | Headsign filter |
|---------------|------|--------|-----------------|
| `89 from Davis` | **5104** (Davis) | `89` | `sullivan` (only direction from this stop for the 89) |
| `88/90 from Tenoch` | **2674** (Highland Ave @ Cutter Ave) | `88`, `90` | none — any headsign at that stop |

Up to **4** times per section. Always include both sections even if one has no predictions.

## Reply format

Reuse the existing titled-block style (`title` + rule line + `N, N min` or `bus: no predictions`). Concatenate sections with a blank line between them.

Example — outbound:

```
89 to Davis
===============
3, 12 min

89 to Clarendon
===============
7, 20 min
```

Example — Davis → home:

```
89 from Davis
===============
5, 18 min

88/90 from Tenoch
===============
2, 14 min
```

## Code changes

### `lib/mbta.ts`

- Change `formatBusReply` title type from the school/home union to `string` so new section titles work without further type churn.
- Make `NextBusQuery.headsignAnyOf` optional: when omitted or empty, keep all matching routes (no headsign filter). Used for Tenoch 88/90.

### `api/inbound-sms.ts`

- Add matchers for Davis→home and outbound davis.
- Wire queries and concatenate formatted sections with a blank line between them.
- Log which intent fired (same style as existing school/home logs).

## Error handling

- **Per-section** failure: if one MBTA query throws, still emit that section as:

```
<title>
===============
Bus times unavailable.
```

- Always return both section titles for multi-section intents, even when one or both queries fail.
## Out of scope

- Keyword config DSL / registry  
- Changing school/home stop or routes  
- Weather or MBTA stop-number lookup  
- Provider-specific SMS encoding beyond plain text

## Testing

Manual / local POST to `/api/inbound-sms` with bodies such as:

- `davis` → two 89 sections from 2729  
- `davis home`, `davis to home`, `home from davis` → both homebound sections  
- `home` alone → existing school-area home reply (2721)  
- `school` / `weather` / `MBTA 2729` → unchanged  

Optional: unit-test headsign matching when “any headsign” is added.

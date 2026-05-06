## Goal
Cut Binance candle load time from ~12s to under 3s, and make repeat loads instant.

## Root cause
`src/lib/binance.ts` fetches 1000-bar chunks **sequentially** in a `while` loop with an extra 50ms `setTimeout` between each. For ~11.5k bars that's 12 round-trips serialized = slow. There's also no caching, so every reload re-fetches everything.

## Changes

### 1. Rewrite `src/lib/binance.ts`
- **Pre-compute all chunk windows** upfront from `startTime`/`endTime` (1000 minutes per chunk).
- **Fetch the most recent chunk first** and call `onProgress` so the chart can render immediately with the latest 1000 bars.
- **Parallelize remaining chunks in batches of 5** using `Promise.all` (keeps us under Binance's per-IP weight limit while still ~5x faster than serial).
- **Per-chunk retry** with exponential backoff on 429/network errors (preserves current resilience).
- **Drop the 50ms inter-chunk sleep** — batching already paces requests.
- **localStorage cache** keyed by `btc_bars_{start}_{end}`:
  - Read at top of `fetchKlines`; if hit, return immediately and fire `onProgress(total,total)`.
  - Write after dedup+sort. On `QuotaExceededError`, clear all `btc_bars_*` keys and retry once.
- Keep exported API identical (`fetchKlines`, `Bar`, `buildH1Map`, `findH1`, `H1Candle`) so `PO3App.tsx` and `strategy.ts` need no changes.
- Switch endpoint to `https://data-api.binance.vision/api/v3/klines` (already in use) — keep as-is since it has no auth and works in-browser.

### 2. No other files change
`PO3App.tsx` already consumes `fetchKlines(start, end, onProgress)` and the progress bar will animate as batches resolve.

## Expected result
- First load of 7 days 1m: ~2–3s (down from ~12s).
- Chart paints within ~500ms with the most recent 1000 bars while the rest streams in.
- Reload of same range: instant (localStorage hit).
- Cache auto-evicts on quota overflow so it never breaks the app.

## Notes / tradeoffs
- localStorage caps at ~5MB per origin. ~11.5k bars of JSON ≈ 1.5MB, fits fine. The auto-evict guard handles larger ranges.
- Batch size 5 chosen to stay well under Binance's 1200 weight/min limit (each klines call = weight 2).
- No backend or new dependency required — pure client-side fix.
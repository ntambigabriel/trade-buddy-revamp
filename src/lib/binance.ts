export interface Bar {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CACHE_PREFIX = "btc_bars_";
const CHUNK_BARS = 1000;
const CHUNK_MS = CHUNK_BARS * 60 * 1000;
const BATCH_SIZE = 20;

function cacheKey(start: number, end: number) {
  return `${CACHE_PREFIX}${start}_${end}`;
}

function readCache(key: string): Bar[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr as Bar[];
  } catch {}
  return null;
}

function writeCache(key: string, bars: Bar[]) {
  const payload = JSON.stringify(bars);
  try {
    localStorage.setItem(key, payload);
  } catch {
    // Quota exceeded — clear our prefix and retry once
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, payload);
    } catch {}
  }
}

async function fetchChunk(startTime: number, endTime: number, retries = 0): Promise<Bar[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${CHUNK_BARS}&startTime=${startTime}&endTime=${endTime}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && retries < 5) {
        await new Promise((r) => setTimeout(r, 1000 * (retries + 1)));
        return fetchChunk(startTime, endTime, retries + 1);
      }
      throw new Error(`Binance error ${res.status}`);
    }
    const data: any[] = await res.json();
    return data.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (e) {
    if (retries < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (retries + 1)));
      return fetchChunk(startTime, endTime, retries + 1);
    }
    throw e;
  }
}

export async function fetchKlines(
  startTime: number,
  endTime: number,
  onProgress?: (fetched: number, total: number) => void
): Promise<Bar[]> {
  const totalEstimate = Math.max(1, Math.floor((endTime - startTime) / 60000));

  // Cache hit
  const key = cacheKey(startTime, endTime);
  const cached = readCache(key);
  if (cached) {
    onProgress?.(cached.length, cached.length);
    return cached;
  }

  // Pre-compute chunk windows
  const chunks: Array<{ start: number; end: number }> = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const end = Math.min(cursor + CHUNK_MS - 1, endTime);
    chunks.push({ start: cursor, end });
    cursor += CHUNK_MS;
  }

  const collected: Bar[] = [];
  let fetched = 0;

  // Fetch the most recent chunk first so the chart can paint immediately
  if (chunks.length) {
    const last = chunks.pop()!;
    const bars = await fetchChunk(last.start, last.end);
    collected.push(...bars);
    fetched += bars.length;
    onProgress?.(fetched, totalEstimate);
  }

  // Parallelize the rest in batches of BATCH_SIZE
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((c) => fetchChunk(c.start, c.end)));
    for (const bars of results) {
      collected.push(...bars);
      fetched += bars.length;
    }
    onProgress?.(fetched, totalEstimate);
  }

  // Sort + dedupe
  collected.sort((a, b) => a.time - b.time);
  const dedup: Bar[] = [];
  let prev = -1;
  for (const b of collected) {
    if (b.time !== prev) {
      dedup.push(b);
      prev = b.time;
    }
  }

  writeCache(key, dedup);
  return dedup;
}

export interface H1Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function buildH1Map(bars: Bar[]): Map<number, H1Candle> {
  const map = new Map<number, H1Candle>();
  for (const b of bars) {
    const key = Math.floor(b.time / 3600) * 3600;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { time: key, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      existing.high = Math.max(existing.high, b.high);
      existing.low = Math.min(existing.low, b.low);
      existing.close = b.close;
    }
  }
  return map;
}

export function findH1(map: Map<number, H1Candle>, time: number): H1Candle | undefined {
  const key = Math.floor(time / 3600) * 3600;
  if (map.has(key)) return map.get(key);
  let k = key - 3600;
  for (let i = 0; i < 48 && k > 0; i++, k -= 3600) {
    if (map.has(k)) return map.get(k);
  }
  return undefined;
}

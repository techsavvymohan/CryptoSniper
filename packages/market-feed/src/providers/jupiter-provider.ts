interface PriceEntry {
  price: number;
  cachedAt: number;
}

// In-memory cache with 5-second TTL
const priceCache = new Map<string, PriceEntry>();
const CACHE_TTL_MS = 5_000;

// Sliding-window rate limiter: max 10 req/s
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_SECOND = 10;

async function acquireRateLimit(): Promise<void> {
  const now = Date.now();
  const windowStart = now - 1_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < windowStart) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {
    // Wait until the oldest request falls outside the window
    const waitMs = 1_000 - (now - requestTimestamps[0]!);
    await new Promise(resolve => setTimeout(resolve, waitMs > 0 ? waitMs : 0));
  }
  requestTimestamps.push(Date.now());
}

/**
 * Fetch the USD price of a token from Jupiter Price API v2.
 * Uses Node.js built-in fetch, 500ms AbortController timeout.
 * Returns null on any error — never throws.
 */
export async function getJupiterPrice(mintAddress: string): Promise<number | null> {
  // Check cache first
  const cached = priceCache.get(mintAddress);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    await acquireRateLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);

    const response = await fetch(
      `https://price.jup.ag/v4/price?ids=${mintAddress}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const json = await response.json() as { data?: Record<string, { price?: number }> };
    const price = json.data?.[mintAddress]?.price;

    if (typeof price !== 'number') return null;

    priceCache.set(mintAddress, { price, cachedAt: Date.now() });
    return price;
  } catch {
    return null;
  }
}

export function clearPriceCache(): void {
  priceCache.clear();
}

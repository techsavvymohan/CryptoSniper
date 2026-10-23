import Redis from 'ioredis';
import { CHANNELS } from '@mev-research/shared';

export { CHANNELS };
export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
export type MessageHandler = (channel: string, data: unknown) => void;

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Two separate ioredis instances — one for pub/write, one for subscribe
const publisherConn = new Redis(REDIS_URL, { lazyConnect: true });
const subscriberConn = new Redis(REDIS_URL, { lazyConnect: true });

publisherConn.on('error', (err) => console.error('[Redis/pub]', err.message));
subscriberConn.on('error', (err) => console.error('[Redis/sub]', err.message));

subscriberConn.on('message', (channel: string, message: string) => {
  try {
    const data: unknown = JSON.parse(message);
    for (const handler of messageHandlers) {
      handler(channel, data);
    }
  } catch {
    // Malformed JSON — ignore silently
  }
});

const messageHandlers: MessageHandler[] = [];

export async function connectRedis(): Promise<void> {
  await publisherConn.connect();
  await subscriberConn.connect();
}

export async function disconnectRedis(): Promise<void> {
  await publisherConn.quit();
  await subscriberConn.quit();
}

export async function redisHealthCheck(): Promise<boolean> {
  try {
    await publisherConn.ping();
    return true;
  } catch {
    return false;
  }
}

export async function subscribe(channel: ChannelName, handler: MessageHandler): Promise<void> {
  messageHandlers.push(handler);
  await subscriberConn.subscribe(channel);
}

export async function publish(channel: ChannelName, data: unknown): Promise<void> {
  try {
    await publisherConn.publish(channel, JSON.stringify(data));
  } catch {
    // Never throw from publish
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await publisherConn.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  try {
    if (ttlSeconds !== undefined) {
      await publisherConn.set(key, value, 'EX', ttlSeconds);
    } else {
      await publisherConn.set(key, value);
    }
  } catch {
    // Never throw
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await publisherConn.del(key);
  } catch {
    // Never throw
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
}

/**
 * Sliding-window rate limiter using a sorted set.
 * Returns true if the action is allowed (under the limit).
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const now = Date.now();
    const windowStart = now - windowMs;
    const multi = publisherConn.multi();
    multi.zremrangebyscore(key, '-inf', windowStart);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.zcard(key);
    multi.pexpire(key, windowMs);
    const results = await multi.exec();
    const count = results?.[2]?.[1] as number | undefined;
    return (count ?? 0) <= maxRequests;
  } catch {
    return true; // Fail open on Redis error
  }
}

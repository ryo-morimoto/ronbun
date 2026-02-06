import type { MiddlewareHandler } from "hono";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

const buckets = new Map<string, Bucket>();

function getBearerToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

async function shortSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function getClientKey(headers: Headers): Promise<string> {
  const token = getBearerToken(headers);
  if (token) {
    return `token:${await shortSha256(token)}`;
  }

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return `ip:${cfIp}`;

  const trueClientIp = headers.get("true-client-ip");
  if (trueClientIp) return `ip:${trueClientIp}`;

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return `ip:${forwardedFor.split(",")[0].trim()}`;

  return "ip:unknown";
}

function collectExpiredBuckets(now: number): void {
  if (Math.random() > 0.01) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    collectExpiredBuckets(now);

    const clientKey = await getClientKey(c.req.raw.headers);
    const bucketKey = `${options.keyPrefix}:${clientKey}`;
    const resetAt = now + options.windowMs;
    const current = buckets.get(bucketKey);

    if (!current || current.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt });
      c.header("X-RateLimit-Limit", String(options.limit));
      c.header("X-RateLimit-Remaining", String(options.limit - 1));
      c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      return next();
    }

    if (current.count >= options.limit) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(options.limit));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
      return c.json(
        {
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          retryAfter,
        },
        429,
      );
    }

    current.count += 1;
    buckets.set(bucketKey, current);

    c.header("X-RateLimit-Limit", String(options.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, options.limit - current.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
    return next();
  };
}

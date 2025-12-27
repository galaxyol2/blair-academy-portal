function createFixedWindowRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = String(keyFn(req) || "").trim() || "anonymous";

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "Too many requests" });
    }

    return next();
  };
}

function requestIp(req) {
  const xfwd = String(req.headers["x-forwarded-for"] || "").trim();
  if (xfwd) return xfwd.split(",")[0].trim();
  return String(req.ip || "").trim();
}

module.exports = { createFixedWindowRateLimiter, requestIp };


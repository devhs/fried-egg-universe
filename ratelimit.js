// 인메모리 고정창(fixed-window) rate limiter.
// 단일 EC2 인스턴스 전제(분산 환경이면 Redis 등 필요).
// now 주입 가능 → 결정론적 단위테스트.
function createLimiter({ limit, windowMs, now = Date.now } = {}) {
  if (!(limit > 0) || !(windowMs > 0)) throw new Error('limit/windowMs는 양수여야 합니다');
  const buckets = new Map(); // key -> { count, resetAt }

  function check(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t >= b.resetAt) {
      b = { count: 0, resetAt: t + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    const ok = b.count <= limit;
    return {
      ok,
      remaining: Math.max(0, limit - b.count),
      retryAfterSec: ok ? 0 : Math.ceil((b.resetAt - t) / 1000),
    };
  }

  // 메모리 누수 방지: 만료된 버킷 정리
  function sweep() {
    const t = now();
    for (const [k, b] of buckets) if (t >= b.resetAt) buckets.delete(k);
  }

  return { check, sweep, _buckets: buckets };
}

// Express 미들웨어 팩토리. keyFn 기본은 IP.
function rateLimit({ limit, windowMs, keyFn, disabled = false, message = '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.' }) {
  if (disabled) return (req, res, next) => next();
  const limiter = createLimiter({ limit, windowMs });
  const getKey = keyFn || ((req) => req.ip || req.socket?.remoteAddress || 'unknown');
  const iv = setInterval(() => limiter.sweep(), windowMs);
  if (iv.unref) iv.unref();
  const mw = (req, res, next) => {
    const r = limiter.check(getKey(req));
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', r.remaining);
    if (!r.ok) {
      res.setHeader('Retry-After', r.retryAfterSec);
      return res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfterSec: r.retryAfterSec });
    }
    next();
  };
  mw._limiter = limiter;
  return mw;
}

module.exports = { createLimiter, rateLimit };

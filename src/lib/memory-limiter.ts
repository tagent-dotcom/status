// Best-effort in-process limits for database-less deployments. Each server instance keeps its
// own counters, so on platforms that run many instances (Vercel) the effective limit is higher
// than configured; the probe network's own limits remain the hard ceiling.

const MAX_KEYS = 50_000;

interface Window {
  start: number;
  count: number;
}

export class MemoryLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one hit; returns seconds to wait when over `limit`, or 0 when allowed. */
  hit(key: string, windowSeconds: number, limit: number): number {
    const now = this.now();
    const start = Math.floor(now / 1000 / windowSeconds) * windowSeconds * 1000;
    const mapKey = `${key}|${windowSeconds}`;
    const current = this.windows.get(mapKey);
    const window = current && current.start === start ? current : { start, count: 0 };
    if (window.count >= limit) {
      return Math.max(1, Math.ceil((start + windowSeconds * 1000 - now) / 1000));
    }
    window.count += 1;
    this.windows.set(mapKey, window);
    if (this.windows.size > MAX_KEYS) this.evict(now);
    return 0;
  }

  private evict(now: number) {
    for (const [k, w] of this.windows) {
      const seconds = Number(k.slice(k.lastIndexOf("|") + 1));
      if (w.start + seconds * 1000 < now) this.windows.delete(k);
    }
    // Still too big (sustained abuse from many IPs): drop the oldest entries.
    for (const k of this.windows.keys()) {
      if (this.windows.size <= MAX_KEYS * 0.9) break;
      this.windows.delete(k);
    }
  }
}

/** Short-lived memo of recent identical checks, so repeated clicks share one measurement. */
export class RecentChecks {
  private readonly entries = new Map<string, { id: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): string | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expires < this.now()) {
      this.entries.delete(key);
      return null;
    }
    return e.id;
  }

  set(key: string, id: string, ttlSeconds: number) {
    this.entries.set(key, { id, expires: this.now() + ttlSeconds * 1000 });
    if (this.entries.size > MAX_KEYS) {
      const now = this.now();
      for (const [k, e] of this.entries) if (e.expires < now) this.entries.delete(k);
      for (const k of this.entries.keys()) {
        if (this.entries.size <= MAX_KEYS * 0.9) break;
        this.entries.delete(k);
      }
    }
  }
}

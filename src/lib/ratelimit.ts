import type { Sql } from "./db/client";

export interface ConsumeResult {
  allowed: boolean;
  /** Start of the fixed window the cost was charged to (needed to refund). */
  windowStart: Date;
  retryAfterSeconds: number;
}

/**
 * Atomically adds `cost` to a fixed-window counter if the result stays within `limit`.
 * Denied attempts are not charged. Works across any number of app instances because the
 * single INSERT ... ON CONFLICT ... WHERE statement is atomic in Postgres. Window boundaries
 * use the database clock so instances with skewed clocks agree.
 */
export async function consume(sql: Sql, key: string, windowSeconds: number, limit: number, cost = 1): Promise<ConsumeResult> {
  // Parameters are cast explicitly: untyped parameters compared with each other are treated
  // as text by Postgres ('6' <= '100000' is false).
  const [row] = await sql<{ window_start: Date; retry_after: number; count: number | null }[]>`
    WITH w AS (
      SELECT to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}::int) * ${windowSeconds}::int) AS start
    ), upsert AS (
      INSERT INTO rate_limit_counters AS c (bucket_key, window_start, count, expires_at)
      SELECT ${key}::text, w.start, ${cost}::int, w.start + make_interval(secs => ${windowSeconds}::int)
      FROM w
      WHERE ${cost}::int <= ${limit}::int
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = c.count + EXCLUDED.count
      WHERE c.count + EXCLUDED.count <= ${limit}::int
      RETURNING c.count
    )
    SELECT w.start AS window_start,
           ceil(extract(epoch FROM (w.start + make_interval(secs => ${windowSeconds}::int) - now())))::int AS retry_after,
           (SELECT count FROM upsert) AS count
    FROM w
  `;

  // Opportunistic cleanup keeps the table small without a separate cron job.
  if (Math.random() < 0.01) {
    await sql`DELETE FROM rate_limit_counters WHERE expires_at < now() - interval '1 hour'`;
  }

  return {
    allowed: row.count !== null,
    windowStart: row.window_start,
    retryAfterSeconds: Math.max(1, row.retry_after),
  };
}

/** Returns `cost` to a window previously charged by `consume` (never below zero). */
export async function refund(sql: Sql, key: string, windowStart: Date, cost: number): Promise<void> {
  if (cost <= 0) return;
  await sql`
    UPDATE rate_limit_counters
    SET count = greatest(0, count - ${cost}::int)
    WHERE bucket_key = ${key} AND window_start = ${windowStart}
  `;
}

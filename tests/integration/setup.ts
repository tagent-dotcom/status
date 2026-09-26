import path from "node:path";
import { resetConfigForTests, getConfig, type Config } from "../../src/lib/config";
import { closeSql, getSql, type Sql } from "../../src/lib/db/client";
import { migrate } from "../../src/lib/db/migrate";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://status:status@localhost:5432/status_test";

export function configure(overrides: Record<string, string> = {}): Config {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.IP_HASH_SECRET = "integration-test-secret";
  process.env.UNSAFE_SKIP_DNS_CHECK = "true";
  process.env.RATE_LIMIT_PER_MINUTE = "1000";
  process.env.RATE_LIMIT_PER_HOUR = "10000";
  process.env.GLOBALPING_HOURLY_PROBE_BUDGET = "100000";
  process.env.MAX_PROBES_PER_CHECK = "50";
  process.env.CHECK_DEDUPE_SECONDS = "60";
  Object.assign(process.env, overrides);
  resetConfigForTests();
  return getConfig();
}

export async function prepareDatabase(): Promise<Sql> {
  configure();
  const sql = getSql();
  await migrate(sql, path.join(process.cwd(), "migrations"));
  return sql;
}

export async function truncateAll(sql: Sql): Promise<void> {
  await sql`TRUNCATE check_results, checks, sites, rate_limit_counters RESTART IDENTITY CASCADE`;
}

export { closeSql };

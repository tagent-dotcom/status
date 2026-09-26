import postgres from "postgres";
import { getConfig } from "../config";

export type Sql = postgres.Sql;

// Reuse one pool per process. In dev, Next.js hot reload re-evaluates modules, so the pool is
// stashed on globalThis to avoid leaking a new pool on every edit.
const globalForDb = globalThis as unknown as { __statusSql?: Sql };

export function getSql(): Sql {
  if (!globalForDb.__statusSql) {
    const config = getConfig();
    globalForDb.__statusSql = postgres(config.DATABASE_URL, {
      max: config.DATABASE_POOL_MAX,
      idle_timeout: 30,
      connect_timeout: 10,
      // int8 (ids, count(*)) comes back as a string by default. Parse to number: our values
      // stay far below 2^53, and JS BigInt can't be JSON-serialised in API responses.
      types: {
        int8: {
          to: 20,
          from: [20],
          serialize: (value: number) => String(value),
          parse: (value: string) => Number(value),
        },
      },
      transform: { undefined: null },
      // Postgres NOTICEs ("already exists, skipping") are informational; don't spam stdout.
      onnotice: () => {},
    });
  }
  return globalForDb.__statusSql;
}

export async function closeSql(): Promise<void> {
  const sql = globalForDb.__statusSql;
  globalForDb.__statusSql = undefined;
  if (sql) await sql.end({ timeout: 5 });
}

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "./client";

// Arbitrary constant; every instance uses the same key so only one migrates at a time.
const MIGRATION_LOCK_KEY = 815_204_311;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every `migrations/*.sql` file not yet recorded in `schema_migrations`, in filename
 * order, each in its own transaction. A session-level advisory lock serialises concurrent
 * deploys. An already-applied file whose contents changed is a hard error: migrations are
 * append-only.
 */
export async function migrate(sql: Sql, migrationsDir: string): Promise<MigrationResult> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  return sql.begin(async (tx) => {
    // Transaction-scoped lock: released automatically on commit/rollback, and holds across
    // every statement below because they all run on this one connection.
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const rows = await tx<{ name: string; checksum: string }[]>`SELECT name, checksum FROM schema_migrations`;
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      const body = await readFile(path.join(migrationsDir, file), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead.`);
        }
        result.skipped.push(file);
        continue;
      }
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${file}, ${checksum})`;
      result.applied.push(file);
    }
    return result;
  });
}

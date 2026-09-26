// Deletes data past its retention period. Run daily (cron, scheduled job, etc.):
//   npm run db:prune
// Deletes in small batches so it never holds long locks on a busy database.
import { z } from "zod";
import { closeSql, getSql } from "../src/lib/db/client";

const retentionDays = z.coerce.number().int().min(1).default(400).parse(process.env.RESULT_RETENTION_DAYS ?? undefined);
const FAILED_CHECK_RETENTION_DAYS = 7;
const BATCH = 1000;

async function deleteInBatches(label: string, run: () => Promise<number>) {
  let total = 0;
  for (;;) {
    const n = await run();
    total += n;
    if (n < BATCH) break;
  }
  console.log(`${label}: deleted ${total}`);
}

async function main() {
  const sql = getSql();
  // Deleting a check cascades to its per-probe results.
  await deleteInBatches(`checks older than ${retentionDays} days`, async () => {
    const r = await sql`
      DELETE FROM checks WHERE id IN (
        SELECT id FROM checks WHERE created_at < now() - make_interval(days => ${retentionDays}::int) LIMIT ${BATCH}
      )`;
    return r.count;
  });
  await deleteInBatches(`failed checks older than ${FAILED_CHECK_RETENTION_DAYS} days`, async () => {
    const r = await sql`
      DELETE FROM checks WHERE id IN (
        SELECT id FROM checks
        WHERE status = 'failed' AND created_at < now() - make_interval(days => ${FAILED_CHECK_RETENTION_DAYS}::int)
        LIMIT ${BATCH}
      )`;
    return r.count;
  });
  const r = await sql`DELETE FROM rate_limit_counters WHERE expires_at < now()`;
  console.log(`expired rate-limit counters: deleted ${r.count}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

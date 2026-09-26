import path from "node:path";
import { closeSql, getSql } from "../src/lib/db/client";
import { migrate } from "../src/lib/db/migrate";

async function main() {
  const result = await migrate(getSql(), path.join(process.cwd(), "migrations"));
  for (const name of result.applied) console.log(`applied  ${name}`);
  console.log(`${result.applied.length} applied, ${result.skipped.length} already up to date`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

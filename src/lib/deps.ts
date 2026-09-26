import "server-only";
import type { Deps } from "./checks";
import { getConfig } from "./config";
import { getSql } from "./db/client";
import { GlobalpingClient } from "./globalping/client";
import type { QuickDeps } from "./quick-check";

let globalping: GlobalpingClient | undefined;

/** Dependencies that work with or without a database. */
export function getQuickDeps(): QuickDeps {
  const config = getConfig();
  globalping ??= new GlobalpingClient({ baseUrl: config.GLOBALPING_API_URL, token: config.GLOBALPING_TOKEN });
  return { config, globalping };
}

/** Full dependencies; only call when a database is configured (see hasDatabase()). */
export function getDeps(): Deps {
  return { ...getQuickDeps(), sql: getSql() };
}

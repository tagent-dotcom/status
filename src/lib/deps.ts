import "server-only";
import type { Deps } from "./checks";
import { getConfig } from "./config";
import { getSql } from "./db/client";
import { GlobalpingClient } from "./globalping/client";

let globalping: GlobalpingClient | undefined;

export function getDeps(): Deps {
  const config = getConfig();
  globalping ??= new GlobalpingClient({ baseUrl: config.GLOBALPING_API_URL, token: config.GLOBALPING_TOKEN });
  return { sql: getSql(), config, globalping };
}

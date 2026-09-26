export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined) return "–";
  const pct = ratio * 100;
  // Never round a partial outage up to "100%" or a near-total one down to "0%".
  if (pct > 99.9 && pct < 100) return `>${(100 - 10 ** -digits).toFixed(digits)}%`;
  if (pct > 0 && pct < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`;
  return `${pct.toFixed(pct === 100 || pct === 0 ? 0 : digits)}%`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en").format(n);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";
}

export function formatBucket(iso: string, unit: "hour" | "day" | "week"): string {
  const d = new Date(iso);
  if (unit === "hour") {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }).format(d);
  }
  const label = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  return unit === "week" ? `Week of ${label}` : label;
}

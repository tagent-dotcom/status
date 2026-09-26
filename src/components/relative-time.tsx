"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";

const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

// Rounded so the snapshot is stable between ticks (useSyncExternalStore requires that).
const clientNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverNow = () => null;

/**
 * Renders the absolute UTC time on the server and during hydration, then "5 minutes ago" on
 * the client, so server and client HTML always match (relative time depends on the viewer's clock).
 */
export function RelativeTime({ iso }: { iso: string }) {
  const now = useSyncExternalStore(subscribe, clientNow, serverNow);
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {now === null ? formatDateTime(iso) : formatRelative(iso, now)}
    </time>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchCheck } from "@/lib/api-client";
import type { CheckView } from "@/lib/checks";

// Live-check pieces shared by the home page (quick checks) and the per-site status page.

const POLL_MS = 1500;
const MAX_POLL_MS = 4 * 60_000;

/** Polls a pending check until it finishes, fails, or we give up. */
export function useCheckPolling(initial: CheckView | null, watchId: string | null, onDone: () => void) {
  const [check, setCheck] = useState<CheckView | null>(initial);
  // Errors are tagged with the check they belong to, so starting a new check clears them
  // without a synchronous setState in the effect.
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!watchId) return;
    const controller = new AbortController();
    const started = Date.now();
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const setPollError = (message: string) => setFailure({ id: watchId, message });

    const tick = async () => {
      try {
        const view = await fetchCheck(watchId, controller.signal);
        failures = 0;
        setCheck(view);
        if (view.status !== "pending") {
          onDoneRef.current();
          return;
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) {
          setPollError("That check doesn't exist (it may have been removed). Run a new check.");
          return;
        }
        failures += 1;
        if (failures >= 6) {
          setPollError("Lost contact with the server while waiting for results. Refresh the page to try again.");
          return;
        }
      }
      if (Date.now() - started > MAX_POLL_MS) {
        setPollError("This check is taking unusually long. Refresh the page to see if it finished.");
        return;
      }
      // Back off gently after errors.
      timer = setTimeout(tick, POLL_MS * (1 + failures));
    };

    // A finished check passed from the server needs no polling.
    if (initial?.id === watchId && initial.status !== "pending") return;
    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the watched id changes
  }, [watchId]);

  const pollError = failure && failure.id === watchId ? failure.message : null;
  return { check, pollError };
}

export function Progress({ check }: { check: CheckView }) {
  const expected = check.probesCount ?? check.requestedProbes;
  const done = check.results.length;
  const pct = expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0;
  return (
    <div className="rounded-lg border border-line bg-surface p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">Checking {check.hostname} from {expected || "…"} locations…</span>
        <span className="tabular text-ink-2">
          {done}/{expected || "?"} results
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">Most checks finish in 10–30 seconds. Slow or blocked sites take longer because probes wait for timeouts.</p>
    </div>
  );
}


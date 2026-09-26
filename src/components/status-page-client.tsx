"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError, fetchCheck } from "@/lib/api-client";
import type { CheckView } from "@/lib/checks";
import { CheckForm, type StartedCheck } from "./check-form";
import { CheckResults } from "./check-results";
import { HistoryPanel } from "./history-panel";

const POLL_MS = 1500;
const MAX_POLL_MS = 4 * 60_000;

/** Polls a pending check until it finishes, fails, or we give up. */
function useCheckPolling(initial: CheckView | null, watchId: string | null, onDone: () => void) {
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

function Progress({ check }: { check: CheckView }) {
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

function StatusPageInner({ hostname, initialCheck }: { hostname: string; initialCheck: CheckView | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchId = searchParams.get("check") ?? (initialCheck?.status === "pending" ? initialCheck.id : null);
  const [historyKey, setHistoryKey] = useState(0);
  const [showForm, setShowForm] = useState(initialCheck === null);
  const { check, pollError } = useCheckPolling(initialCheck, watchId, () => setHistoryKey(Date.now()));

  function onStarted(started: StartedCheck) {
    if (started.hostname !== hostname) {
      router.push(`/status/${encodeURIComponent(started.hostname)}?check=${started.checkId}`);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("check", started.checkId);
    router.replace(`${pathname}?${params}`, { scroll: false });
    setShowForm(false);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        {showForm ? (
          <CheckForm initialUrl={check?.targetUrl ?? `https://${hostname}/`} submitLabel="Run check" onStarted={onStarted} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">Check again from different countries, cities or ISPs.</p>
            <button type="button" onClick={() => setShowForm(true)} className="h-10 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90">
              Run a new check
            </button>
          </div>
        )}
      </section>

      {pollError && (
        <p role="alert" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-critical-text">
          {pollError}
        </p>
      )}

      {check?.status === "pending" && <Progress check={check} />}
      {check?.status === "failed" && (
        <p role="alert" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-critical-text">
          {check.error?.message ?? "The check failed."}
        </p>
      )}
      {check && (check.status === "finished" || check.results.length > 0) && <CheckResults check={check} />}
      {!check && !watchId && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          Nobody has checked {hostname} yet. Run the first check above to see whether it loads around the world.
        </p>
      )}

      <HistoryPanel hostname={hostname} refreshKey={historyKey} />
    </div>
  );
}

export function StatusPageClient(props: { hostname: string; initialCheck: CheckView | null }) {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <StatusPageInner {...props} />
    </Suspense>
  );
}

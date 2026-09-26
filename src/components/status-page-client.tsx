"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { CheckView } from "@/lib/checks";
import { CheckForm, type StartedCheck } from "./check-form";
import { Progress, useCheckPolling } from "./check-live";
import { CheckResults } from "./check-results";
import { HistoryPanel } from "./history-panel";

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

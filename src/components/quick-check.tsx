"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckForm, type StartedCheck } from "./check-form";
import { Progress, useCheckPolling } from "./check-live";
import { CheckResults } from "./check-results";

// Single-page checker used when no database is configured: the form and the live results live
// on the home page, and the result is addressable (and shareable) as /?check=<id>.

function QuickCheckInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchId = searchParams.get("check");
  const prefill = searchParams.get("url") ?? "";
  const { check, pollError } = useCheckPolling(null, watchId, () => {});
  // Ignore a stale result from a previous check while the new one loads.
  const current = check && check.id === watchId ? check : null;

  function onStarted(started: StartedCheck) {
    router.replace(`${pathname}?check=${encodeURIComponent(started.checkId)}`, { scroll: false });
  }

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-surface p-4 text-left shadow-sm sm:p-5">
        <CheckForm initialUrl={current?.targetUrl ?? prefill} onStarted={onStarted} />
      </div>
      {watchId && (
        <div className="space-y-5 text-left">
          {pollError && (
            <p role="alert" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-critical-text">
              {pollError}
            </p>
          )}
          {!current && !pollError && <p className="text-sm text-muted">Starting check…</p>}
          {current?.status === "pending" && <Progress check={current} />}
          {current && (current.status === "finished" || current.results.length > 0) && <CheckResults check={current} />}
        </div>
      )}
    </div>
  );
}

export function QuickCheck() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <QuickCheckInner />
    </Suspense>
  );
}

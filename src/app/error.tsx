"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-ink-2">We couldn&apos;t load this page. This is on our side; please try again in a moment.</p>
      <button type="button" onClick={reset} className="rounded-lg bg-accent px-5 py-2 font-semibold text-on-accent">
        Try again
      </button>
    </div>
  );
}

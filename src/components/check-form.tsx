"use client";

import { useState } from "react";
import { ApiError, startCheck } from "@/lib/api-client";
import { locationRequestSchema } from "@/lib/locations";
import { parseTarget } from "@/lib/target";
import { LocationPicker, initialPickerState, toLocationRequest, type PickerState } from "./location-picker";

export interface StartedCheck {
  checkId: string;
  hostname: string;
  reused: boolean;
}

export function CheckForm({
  initialUrl = "",
  submitLabel = "Check from around the world",
  onStarted,
}: {
  initialUrl?: string;
  submitLabel?: string;
  onStarted: (check: StartedCheck) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [picker, setPicker] = useState<PickerState>(initialPickerState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const target = parseTarget(url);
    if (!target.ok) {
      setError(target.message);
      return;
    }
    const locations = locationRequestSchema.safeParse(toLocationRequest(picker));
    if (!locations.success) {
      setError(locations.error.issues[0]?.message ?? "Check the locations you picked.");
      return;
    }

    setSubmitting(true);
    try {
      const started = await startCheck(target.target.url, locations.data);
      onStarted(started);
    } catch (e) {
      if (e instanceof ApiError && e.retryAfterSeconds) {
        const wait = e.retryAfterSeconds < 90 ? `${Math.ceil(e.retryAfterSeconds)} seconds` : `${Math.ceil(e.retryAfterSeconds / 60)} minutes`;
        setError(`${e.message} (try again in about ${wait})`);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="check-url">
          Website address
        </label>
        <input
          id="check-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "check-error" : undefined}
          className="h-12 min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 text-base text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-12 shrink-0 rounded-lg bg-accent px-6 text-base font-semibold text-on-accent hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Starting…" : submitLabel}
        </button>
      </div>
      {error && (
        <p id="check-error" role="alert" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-critical-text">
          {error}
        </p>
      )}
      <LocationPicker state={picker} onChange={setPicker} />
    </form>
  );
}

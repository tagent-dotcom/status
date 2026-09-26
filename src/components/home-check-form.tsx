"use client";

import { useRouter } from "next/navigation";
import { CheckForm } from "./check-form";

export function HomeCheckForm() {
  const router = useRouter();
  return (
    <CheckForm
      onStarted={(started) => router.push(`/status/${encodeURIComponent(started.hostname)}?check=${started.checkId}`)}
    />
  );
}

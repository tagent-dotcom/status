import type { AreaStatus } from "@/lib/analysis";
import type { Outcome } from "@/lib/diagnosis-info";

// Status is never shown by colour alone: every swatch carries an icon and a text label.

type Kind = AreaStatus | Outcome;

const META: Record<Kind, { label: string; color: string; icon: "check" | "alert" | "half" | "cross" | "question" }> = {
  up: { label: "Up", color: "var(--good)", icon: "check" },
  degraded: { label: "Degraded", color: "var(--warning)", icon: "alert" },
  partial: { label: "Partial outage", color: "var(--serious)", icon: "half" },
  down: { label: "Down", color: "var(--critical)", icon: "cross" },
  unknown: { label: "No data", color: "var(--no-data)", icon: "question" },
  inconclusive: { label: "Inconclusive", color: "var(--no-data)", icon: "question" },
};

export function statusLabel(kind: Kind): string {
  return META[kind].label;
}

export function statusColor(kind: Kind): string {
  return META[kind].color;
}

export function StatusIcon({ kind, size = 16 }: { kind: Kind; size?: number }) {
  const { color, icon } = META[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="status-swatch shrink-0">
      <circle cx="8" cy="8" r="8" fill={color} />
      {icon === "check" && <path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {icon === "cross" && <path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
      {icon === "alert" && (
        <>
          <path d="M8 4.2v4.6" stroke="#0b0b0b" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="1.05" fill="#0b0b0b" />
        </>
      )}
      {icon === "half" && <path d="M8 3.2a4.8 4.8 0 0 1 0 9.6z" fill="#fff" />}
      {icon === "question" && (
        <path d="M6.1 6.3a1.95 1.95 0 1 1 2.6 1.85c-.45.2-.7.55-.7 1.05v.3M8 11.6v.05" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function StatusBadge({ kind, label }: { kind: Kind; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-ink">
      <StatusIcon kind={kind} />
      {label ?? META[kind].label}
    </span>
  );
}

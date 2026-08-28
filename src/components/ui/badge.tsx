/**
 * Status pills used across admin/panel screens (plan §6.S3: "every entity
 * screen styled consistently"). `tone` follows the dataviz skill's status
 * palette — reserved for state, never reused as a generic series color —
 * mapped once per domain below so every page reads the same status the
 * same way.
 */
const TONE = {
  neutral: "bg-ink/[0.06] text-ink/70",
  good: "bg-emerald-50 text-emerald-800",
  accent: "bg-accent/10 text-accent",
  warning: "bg-amber-50 text-amber-900",
  serious: "bg-orange-50 text-orange-900",
  critical: "bg-red-50 text-red-700",
} as const;

export type Tone = keyof typeof TONE;

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function bookingStatusTone(status: string): Tone {
  switch (status) {
    case "completed":
      return "good";
    case "active":
    case "confirmed":
      return "accent";
    case "cancelled":
      return "critical";
    default:
      return "neutral"; // inquiry
  }
}

export function cleaningStatusTone(status: string): Tone {
  switch (status) {
    case "ready":
      return "good";
    case "in_progress":
      return "accent";
    default:
      return "warning"; // needed
  }
}

export function ticketStatusTone(status: string): Tone {
  switch (status) {
    case "done":
      return "good";
    case "in_progress":
      return "accent";
    default:
      return "warning"; // open
  }
}

export function reminderStatusTone(status: string): Tone {
  switch (status) {
    case "done":
      return "good";
    case "due":
      return "critical";
    default:
      return "warning"; // upcoming
  }
}

export function documentStatusTone(status: string): Tone {
  switch (status) {
    case "verified":
      return "good";
    case "rejected":
      return "critical";
    default:
      return "warning"; // pending
  }
}

export function listingStatusTone(status: string): Tone {
  switch (status) {
    case "published":
      return "good";
    case "paused":
      return "warning";
    default:
      return "neutral"; // draft
  }
}

export function paymentStatusTone(status: string): Tone {
  switch (status) {
    case "paid":
      return "good";
    case "expired":
      return "critical";
    default:
      return "warning"; // pending
  }
}

export function depositStatusTone(status: string): Tone {
  switch (status) {
    case "returned":
      return "good";
    case "deducted":
      return "serious";
    default:
      return "neutral"; // held
  }
}

export function leadForwardTone(status: string): Tone {
  switch (status) {
    case "forwarded":
      return "good";
    case "failed":
      return "critical";
    default:
      return "warning"; // pending
  }
}

export function messageStatusTone(status: string): Tone {
  switch (status) {
    case "sent":
      return "good";
    case "due":
      return "warning";
    case "cancelled":
      return "neutral";
    default:
      return "accent"; // scheduled
  }
}

export function onboardingStepTone(status: string): Tone {
  switch (status) {
    case "done":
      return "good";
    case "skipped":
      return "neutral";
    default:
      return "warning"; // pending
  }
}

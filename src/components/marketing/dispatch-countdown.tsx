"use client";

import { Truck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDuration, minutesToCutoff } from "@/lib/delivery";

const noopSubscribe = () => () => {};

/**
 * "Bestil inden 3 t 12 min – så sender vi i dag" on working days before 19:00; otherwise just
 * the promise. No delivery date is promised. Updated every minute.
 */
export function DispatchCountdown({ className = "" }: { className?: string }) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const minutes = hydrated ? minutesToCutoff(now) : null;
  return (
    <p className={`flex items-center gap-2.5 rounded-[var(--radius-control)] bg-success/10 px-3.5 py-2.5 text-[15px] text-ink ${className}`}>
      <Truck className="size-5 shrink-0 text-success" aria-hidden="true" />
      {minutes !== null ? (
        <span>
          Bestil inden <strong>{formatDuration(minutes)}</strong> – så sender vi i dag
        </span>
      ) : (
        <span>
          <strong>1-dags levering</strong> – bestil før kl. 19 på hverdage
        </span>
      )}
    </p>
  );
}

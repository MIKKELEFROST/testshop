"use client";

import { CalendarHeart } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { Season } from "@/config/store";
import { danishTime, daysBetween, formatDanishDate, nextOccurrence } from "@/lib/seasons";

const NAMES: Record<Season, string> = { fastelavn: "Fastelavn", halloween: "Halloween" };

const subscribe = () => () => {};
const today = () => danishTime(new Date()).date;

/** "Fastelavn er søndag 7. februar · om 115 dage". Worked out in the browser, so it is never stale. */
export function EventCountdown({ season, className = "" }: { season: Season; className?: string }) {
  const date = useSyncExternalStore(subscribe, today, () => null);
  const name = NAMES[season];
  let text = name;
  if (date) {
    const day = nextOccurrence(season, date);
    const days = daysBetween(date, day);
    text =
      days === 0
        ? season === "halloween"
          ? "Glædelig halloween – det er i dag!"
          : "Det er fastelavn i dag!"
        : `${name} er ${formatDanishDate(day)}${days === 1 ? " · i morgen!" : ` · om ${days} dage`}`;
  }
  return (
    <p className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold ${className}`}>
      <CalendarHeart className="size-4 shrink-0" aria-hidden="true" />
      <span suppressHydrationWarning>{text}</span>
    </p>
  );
}

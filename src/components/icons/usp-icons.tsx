import { Package, PackageOpen, PiggyBank, Rabbit, Trophy, type LucideProps } from "lucide-react";
import type { UspIcon as UspIconName } from "@/config/usps";

type IconProps = { className?: string; strokeWidth?: number };

/** Line icons for the selling points: Lucide where it has one, drawn in the same style otherwise. */
export function UspIcon({ name, className, strokeWidth = 1.6 }: IconProps & { name: UspIconName }) {
  const props: LucideProps = { className, strokeWidth, "aria-hidden": true };
  switch (name) {
    case "gift":
      return <PackageOpen {...props} />;
    case "rabbit":
      return <Rabbit {...props} />;
    case "piggy-bank":
      return <PiggyBank {...props} />;
    case "return-30":
      return <Return30 className={className} strokeWidth={strokeWidth} />;
    case "happy":
      return <HeartEyes className={className} strokeWidth={strokeWidth} />;
    case "clock-truck":
      return <ClockTruck className={className} strokeWidth={strokeWidth} />;
    case "denmark":
      return <DanishFlag className={className} />;
    case "box":
      return <Package {...props} />;
    case "trophy":
      return <Trophy {...props} />;
  }
}

function Svg({ className, strokeWidth, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** "30" inside two turning arrows (30 days to return). */
function Return30(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.4 9A9 9 0 0 0 5.6 5.6L3.5 7.6" />
      <path d="M3.5 3.5v4.1h4.1" />
      <path d="M3.6 15a9 9 0 0 0 14.8 3.4l2.1-2" />
      <path d="M20.5 20.5v-4.1h-4.1" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">
        30
      </text>
    </Svg>
  );
}

/** Smiling face with hearts for eyes (happy customers). */
function HeartEyes(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8.5 11.2 6.9 9.7a1 1 0 0 1 1.6-1.2 1 1 0 0 1 1.6 1.2z" />
      <path d="M15.5 11.2l-1.6-1.5a1 1 0 0 1 1.6-1.2 1 1 0 0 1 1.6 1.2z" />
      <path d="M7.2 13.8h9.6a4.8 4.8 0 0 1-9.6 0z" />
    </Svg>
  );
}

/** Clock with a small delivery van (delivered fast). */
function ClockTruck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.6 20.9A9 9 0 1 1 21 11.5" />
      <path d="M11 6.5V11l2.6 1.6" />
      <path d="M14.5 15.5h5l2 2.3v2.2h-7.5z" />
      <circle cx="16.3" cy="20.5" r="1" />
      <circle cx="20" cy="20.5" r="1" />
    </Svg>
  );
}

/** Dannebrog in its official proportions (12 + 4 + 21 by 12 + 4 + 12). */
function DanishFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 37 28" className={className} aria-hidden="true">
      <rect width="37" height="28" fill="#c8102e" />
      <rect x="12" width="4" height="28" fill="#fff" />
      <rect y="12" width="37" height="4" fill="#fff" />
    </svg>
  );
}

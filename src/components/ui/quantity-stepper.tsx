"use client";

/** − n + control for a quantity between 1 and `max`. */
export function QuantityStepper({
  value,
  max,
  onChange,
  disabled,
  label = "Antal",
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-30"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={disabled || value <= 1}
        aria-label="Færre"
      >
        −
      </button>
      <span className="w-8 text-center text-[15px] tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-30"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label="Flere"
      >
        +
      </button>
    </div>
  );
}

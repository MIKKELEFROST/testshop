import type { ComponentProps } from "react";

type FieldProps = Omit<ComponentProps<"input">, "placeholder"> & { label: string; error?: string; hint?: string };

const box =
  "w-full rounded-[var(--radius-control)] border bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-ink focus:ring-1 focus:ring-ink";

/**
 * Text input with a floating label: the label sits inside the empty field like a placeholder
 * and moves to the top edge once the field has focus or a value (also after autofill).
 */
export function Field({ label, error, hint, id, name, className = "", ...props }: FieldProps) {
  const inputId = id ?? name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <div className="relative">
        <input
          id={inputId}
          name={name}
          // A blank placeholder makes :placeholder-shown mean "empty", which positions the label.
          placeholder=" "
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`peer h-[52px] pb-1.5 pt-5 ${box} ${error ? "border-danger" : "border-line-strong"}`}
          {...props}
        />
        <label
          htmlFor={inputId}
          className="pointer-events-none absolute left-3.5 right-3.5 top-1/2 -translate-y-1/2 truncate text-[15px] text-muted transition-all duration-150 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
        >
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SelectProps = ComponentProps<"select"> & { label: string; error?: string };

/** Select with its label inside the box, matching Field. */
export function SelectField({ label, error, id, name, children, className = "", ...props }: SelectProps) {
  const inputId = id ?? name;
  return (
    <div className={className}>
      <div className="relative">
        <select
          id={inputId}
          name={name}
          aria-invalid={error ? true : undefined}
          className={`h-[52px] appearance-none pb-1.5 pr-10 pt-5 ${box} ${error ? "border-danger" : "border-line-strong"}`}
          {...props}
        >
          {children}
        </select>
        <label htmlFor={inputId} className="pointer-events-none absolute left-3.5 top-2 text-xs text-muted">
          {label}
        </label>
        <svg
          viewBox="0 0 16 16"
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

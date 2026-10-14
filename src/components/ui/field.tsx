import type { ComponentProps } from "react";

type FieldProps = ComponentProps<"input"> & { label: string; error?: string; hint?: string };

export function Field({ label, error, hint, id, name, className = "", ...props }: FieldProps) {
  const inputId = id ?? name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-12 w-full rounded-[var(--radius-control)] border bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-ink focus:ring-1 focus:ring-ink ${
          error ? "border-danger" : "border-line-strong"
        }`}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SelectProps = ComponentProps<"select"> & { label: string; error?: string };

export function SelectField({ label, error, id, name, children, className = "", ...props }: SelectProps) {
  const inputId = id ?? name;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}
      </label>
      <select
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`h-12 w-full rounded-[var(--radius-control)] border bg-surface px-3 text-[15px] text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink ${
          error ? "border-danger" : "border-line-strong"
        }`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

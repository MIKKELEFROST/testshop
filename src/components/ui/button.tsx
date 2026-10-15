import Link from "next/link";
import type { ComponentProps } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

export function buttonClasses(variant: Variant = "primary", size: Size = "md", full = false) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none";
  const variants: Record<Variant, string> = {
    primary: "bg-action text-white hover:bg-action-hover active:bg-action-hover",
    secondary: "border border-line-strong bg-surface text-ink hover:border-ink",
    ghost: "text-ink hover:bg-black/5",
  };
  const sizes: Record<Size, string> = {
    sm: "h-9 px-3 text-sm",
    md: "h-11 px-5 text-[15px]",
    lg: "h-14 px-6 text-base",
  };
  return [base, variants[variant], sizes[size], full ? "w-full" : ""].join(" ");
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size; full?: boolean; loading?: boolean };

export function Button({ variant, size, full, loading, disabled, children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`${buttonClasses(variant, size, full)} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size; full?: boolean };

export function ButtonLink({ variant, size, full, className = "", ...props }: ButtonLinkProps) {
  return <Link className={`${buttonClasses(variant, size, full)} ${className}`} {...props} />;
}

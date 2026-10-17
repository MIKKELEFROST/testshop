import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "error";

const tones: Record<Tone, string> = {
  info: "border-line bg-surface text-ink",
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-warning/30 bg-warning/5 text-warning",
  error: "border-danger/30 bg-danger/5 text-danger",
};

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`animate-fade-in rounded-[var(--radius-control)] border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {title && <p className="font-medium">{title}</p>}
      {/* Full strength: dimmed, the body text fell below 4.5:1 on the tint. */}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

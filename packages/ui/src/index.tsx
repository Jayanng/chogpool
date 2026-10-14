import type { ReactNode } from "react";

export const UI_VERSION = "0.1.0";

export const tokens = {
  color: {
    ground: "#0d1014",
    raised: "#151a20",
    panel: "#1b222a",
    ink: "#f4f6f8",
    muted: "#aab4be",
    faint: "#68737e",
    rule: "rgba(255,255,255,.12)",
    accent: "#ff8a3d",
    lime: "#c6ef6d",
    danger: "#ff6e6e",
  },
  radius: { sm: "10px", md: "16px", lg: "24px", pill: "999px" },
} as const;

export function Button({
  children,
  variant = "primary",
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  variant?: "primary" | "quiet" | "outline";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return <button className={`ui-button ui-button--${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "lime" }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ui-panel ${className}`}>{children}</section>;
}

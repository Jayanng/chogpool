import type { CSSProperties, ReactNode } from "react";

export const UI_VERSION = "0.1.0";

/* ------------------------------------------------------------------ tokens */

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
    accentDeep: "#e06a1e",
    lime: "#c6ef6d",
    danger: "#ff6e6e",
  },
  radius: { sm: "10px", md: "16px", lg: "24px", pill: "999px" },
  space: { xs: "6px", sm: "10px", md: "18px", lg: "28px", xl: "44px", xxl: "72px" },
  type: {
    sans: "'Plus Jakarta Sans', 'Manrope', system-ui, sans-serif",
    mono: "'DM Mono', ui-monospace, monospace",
    scale: {
      kicker: "11px",
      small: "13px",
      body: "16px",
      lede: "18px",
      h2: "clamp(28px, 3.4vw, 44px)",
      h1: "clamp(52px, 6.5vw, 88px)",
    },
  },
  motion: {
    fast: "140ms",
    base: "220ms",
    slow: "420ms",
    spring: {
      snappy: "cubic-bezier(.2,1.2,.3,1)",
      smooth: "cubic-bezier(.22,1,.36,1)",
      settle: "cubic-bezier(.34,1.36,.64,1)",
    },
  },
} as const;

/* -------------------------------------------------------------- components */

export function Button({
  children,
  variant = "primary",
  onClick,
  disabled = false,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "quiet" | "outline";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button className={`ui-button ui-button--${variant}`} onClick={onClick} disabled={disabled} title={title} type="button">
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "lime" | "danger" }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Panel({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`ui-panel ${className}`} style={style}>{children}</section>;
}

export function Card({
  title,
  children,
  footer,
  aside,
}: {
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="ui-card">
      {(title || aside) && (
        <header className="ui-card__head">
          {title ? <h3 className="ui-card__title">{title}</h3> : <span />}
          {aside}
        </header>
      )}
      <div className="ui-card__body">{children}</div>
      {footer && <footer className="ui-card__foot">{footer}</footer>}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "accent" | "lime";
}) {
  return (
    <div className={`ui-stat ui-stat--${tone}`}>
      <div className="ui-stat__label">{label}</div>
      <div className="ui-stat__value">{value}</div>
      {note ? <div className="ui-stat__note">{note}</div> : null}
    </div>
  );
}

export function Marquee({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "accent" | "lime" }) {
  const run = [...items, ...items];
  return (
    <div className={`ui-marquee ui-marquee--${tone}`} aria-hidden="true">
      <div className="ui-marquee__track">
        {run.map((item, i) => (
          <span className="ui-marquee__item" key={`${item}-${i}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

export function Toast({ tone = "info", message }: { tone?: "info" | "success" | "danger"; message: string }) {
  return <div className={`ui-toast ui-toast--${tone}`} role="status">{message}</div>;
}

export function Skeleton({ variant = "text", width, height }: { variant?: "text" | "block" | "circle"; width?: number; height?: number }) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <div className={`ui-skeleton ui-skeleton--${variant}`} style={style} aria-hidden="true" />;
}

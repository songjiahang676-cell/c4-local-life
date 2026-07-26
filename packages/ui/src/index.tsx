import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from "react";

export function Card({
  children,
  className = "",
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`socal-card ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function Button({
  children,
  className = "",
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button className={`socal-button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function SponsoredBadge() {
  return (
    <span aria-label="广告" className="socal-sponsored-badge">
      广告
    </span>
  );
}

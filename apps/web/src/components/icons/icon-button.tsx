import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AppIcon } from "./app-icon";

type IconButtonProps = {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
};

export function IconButton({ href, icon, label, badge }: IconButtonProps) {
  const visibleBadge = badge && badge > 0 ? badge : undefined;

  return (
    <Link className="iconButton" href={href} aria-label={label} title={label}>
      <AppIcon icon={icon} size={17} />
      <span>{label}</span>
      {visibleBadge ? <b className="iconBadge">{visibleBadge}</b> : null}
    </Link>
  );
}

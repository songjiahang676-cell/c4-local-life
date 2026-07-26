import Link from "next/link";
import { AppIcon } from "./app-icon";
import type { IconEntry } from "./icon-types";

export function CategoryShortcut({ item }: { item: IconEntry }) {
  return (
    <Link className={`categoryShortcut theme-${item.theme}`} href={item.href}>
      <span className="shortcutIcon">
        <AppIcon icon={item.icon} size={18} />
      </span>
      <strong>{item.label}</strong>
      {item.badge && item.badge > 0 ? <b className="shortcutBadge">{item.badge}</b> : null}
    </Link>
  );
}

import Link from "next/link";
import { AppIcon } from "./app-icon";
import type { IconEntry } from "./icon-types";

export function QuickPublishItem({ item }: { item: IconEntry }) {
  return (
    <Link className={`publishItem theme-${item.theme}`} href={item.href}>
      <span className="publishIcon">
        <AppIcon icon={item.icon} size={21} />
      </span>
      <span>
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
    </Link>
  );
}

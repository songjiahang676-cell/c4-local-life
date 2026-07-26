import Link from "next/link";
import { AppIcon } from "./app-icon";
import type { IconEntry } from "./icon-types";

export function ServiceEntry({ item }: { item: IconEntry }) {
  return (
    <Link className={`serviceEntry theme-${item.theme}`} href={item.href}>
      <span className="serviceIcon">
        <AppIcon icon={item.icon} size={17} />
      </span>
      <span>
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
    </Link>
  );
}

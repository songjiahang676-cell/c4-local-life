import type { LucideIcon } from "lucide-react";

export type IconTheme = "blue" | "orange" | "green" | "purple" | "red" | "slate";

export type IconEntry = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  theme: IconTheme;
  description?: string;
  badge?: number;
  requiresAuth?: boolean;
};

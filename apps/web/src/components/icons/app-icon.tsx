import type { LucideIcon } from "lucide-react";

type AppIconProps = {
  icon: LucideIcon;
  size?: number;
  label?: string;
  className?: string;
};

export function AppIcon({ icon: Icon, size = 18, label, className }: AppIconProps) {
  return (
    <Icon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      focusable="false"
      size={size}
      strokeWidth={1.8}
    />
  );
}

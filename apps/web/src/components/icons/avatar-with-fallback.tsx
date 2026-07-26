"use client";

import Image from "next/image";
import { useState } from "react";

const FALLBACK_COLORS = ["#2563eb", "#0f8a62", "#7c3aed", "#d65a31", "#b4234d", "#176b87"];

function initialsFor(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "用户";
  return Array.from(normalized).slice(0, 2).join("");
}

function colorFor(name: string): string {
  const hash = Array.from(name).reduce((total, character) => total + character.codePointAt(0)!, 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0]!;
}

type AvatarWithFallbackProps = {
  name: string;
  src?: string;
  size?: number;
};

export function AvatarWithFallback({ name, src, size = 48 }: AvatarWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className="avatarFallback"
        style={{ backgroundColor: colorFor(name), height: size, width: size }}
        aria-label={`${name}头像`}
        role="img"
      >
        {initialsFor(name)}
      </span>
    );
  }

  return (
    <Image
      alt={`${name}头像`}
      className="avatarImage"
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      src={src}
      width={size}
    />
  );
}

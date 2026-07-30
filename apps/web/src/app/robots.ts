import type { MetadataRoute } from "next";
import { publicWebOrigin } from "../lib/seo";

const privatePaths = [
  "/v1/",
  "/health/",
  "/zh-Hans/account",
  "/en-US/account",
  "/zh-Hans/post",
  "/en-US/post",
  "/zh-Hans/auth",
  "/en-US/auth",
  "/zh-Hans/login",
  "/en-US/login",
  "/zh-Hans/register",
  "/en-US/register",
  "/zh-Hans/messages",
  "/en-US/messages",
  "/zh-Hans/favorites",
  "/en-US/favorites",
  "/zh-Hans/points",
  "/en-US/points",
  "/zh-Hans/portal",
  "/en-US/portal",
] as const;

// Host is deployment-specific, so robots.txt must be evaluated with runtime environment values.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...privatePaths],
    },
    host: publicWebOrigin().origin,
  };
}

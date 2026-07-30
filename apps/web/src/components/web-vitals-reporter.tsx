"use client";

import { useReportWebVitals } from "next/web-vitals";

type BrowserMetric = {
  name: string;
  value: number;
};

type ReporterOptions = {
  pathname: () => string;
  random: () => number;
  request: typeof fetch;
  sampleRate: number;
};

const supportedMetrics = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const publicVerticals = new Set(["jobs", "housing", "transfer", "market", "services"]);

function configuredSampleRate(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE ?? "0.1");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
}

export function classifyWebVitalRoute(
  pathname: string,
): "homepage" | "listing-list" | "listing-detail" | "search" | "account" | "other" {
  const path = pathname.replace(/^\/(?:zh-Hans|en-US)(?=\/|$)/, "") || "/";
  if (path === "/") return "homepage";
  if (path === "/search") return "search";
  if (path === "/account" || path.startsWith("/account/")) return "account";
  const segments = path.split("/").filter(Boolean);
  if (segments[0] && publicVerticals.has(segments[0])) {
    return segments.length >= 3 ? "listing-detail" : "listing-list";
  }
  return "other";
}

export function createWebVitalReporter(options: ReporterOptions) {
  return (metric: BrowserMetric): void => {
    if (
      !supportedMetrics.has(metric.name) ||
      !Number.isFinite(metric.value) ||
      metric.value < 0 ||
      options.sampleRate <= 0 ||
      options.random() >= options.sampleRate
    ) {
      return;
    }
    const payload = {
      name: metric.name,
      value: metric.value,
      route: classifyWebVitalRoute(options.pathname()),
    };
    void options
      .request("/v1/performance/web-vitals", {
        method: "POST",
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        keepalive: true,
      })
      .catch(() => undefined);
  };
}

const reportWebVital = createWebVitalReporter({
  pathname: () => window.location.pathname,
  random: Math.random,
  request: fetch,
  sampleRate: configuredSampleRate(),
});

export function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);
  return null;
}

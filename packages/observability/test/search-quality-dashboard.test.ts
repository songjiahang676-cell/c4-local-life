import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

const dashboardPath = new URL(
  "../../../infra/observability/dashboards/search-quality.json",
  import.meta.url,
);

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dashboard value must be an object");
  }
  return value as JsonRecord;
}

function panelExpressions(panel: JsonRecord): string[] {
  if (!Array.isArray(panel.targets)) throw new Error("Every dashboard panel must have targets");
  return panel.targets.map((target) => {
    const expression = record(target).expr;
    if (typeof expression !== "string" || expression.length === 0) {
      throw new Error("Every dashboard target must have a PromQL expression");
    }
    return expression;
  });
}

describe("search quality dashboard contract", () => {
  const dashboard = record(JSON.parse(readFileSync(dashboardPath, "utf8")) as unknown);
  const panels = Array.isArray(dashboard.panels) ? dashboard.panels.map(record) : [];

  it("contains the required runtime quality and sample-volume panels", () => {
    const titles = panels.map((panel) => panel.title);
    expect(dashboard).toMatchObject({
      editable: false,
      refresh: "1m",
      uid: "socal-search-quality",
      title: "SoCal Life / Search Quality",
    });
    expect(new Set(titles)).toEqual(
      new Set([
        "Zero-result rate by locale",
        "Search request p95 latency",
        "Search request volume by locale",
        "Search timeout and unavailable rate",
        "Search index freshness p95",
        "Search recovery failures",
      ]),
    );
  });

  it("derives zero-result and latency from real counters and route-level RED histograms", () => {
    const byTitle = new Map(panels.map((panel) => [panel.title, panel]));
    const zeroResult = panelExpressions(record(byTitle.get("Zero-result rate by locale")))[0] ?? "";
    const latency = panelExpressions(record(byTitle.get("Search request p95 latency")))[0] ?? "";
    const volume =
      panelExpressions(record(byTitle.get("Search request volume by locale")))[0] ?? "";

    expect(zeroResult).toContain('socal_search_queries_total{outcome="empty"}');
    expect(zeroResult).toContain("sum by (locale)");
    expect(zeroResult).toContain("clamp_min");
    expect(volume).toContain("sum by (locale)");
    expect(latency).toContain("histogram_quantile(0.95");
    expect(latency).toContain('socal_http_request_duration_seconds_bucket{route="/v1/search"}');
  });

  it("uses only emitted metrics and fixed non-identifying labels", () => {
    const expressions = panels.flatMap(panelExpressions);
    const allowedMetrics = new Set([
      "socal_search_queries_total",
      "socal_http_request_duration_seconds_bucket",
      "socal_search_index_freshness_seconds_bucket",
      "socal_search_rebuild_operations_total",
      "socal_search_reconciliation_total",
    ]);
    const forbiddenLabels =
      /\b(?:query|cursor|pit|listing_id|category_id|region_id|latitude|longitude|coordinates|amount|provider|user_id|session_id)\s*(?:=|=~)/iu;

    for (const expression of expressions) {
      const metricNames = expression.match(/socal_[a-z_]+/gu) ?? [];
      expect(metricNames.length).toBeGreaterThan(0);
      expect(metricNames.every((metric) => allowedMetrics.has(metric))).toBe(true);
      expect(expression).not.toMatch(forbiddenLabels);
    }
    expect(JSON.stringify(dashboard)).not.toContain("private-query");
    expect(JSON.stringify(dashboard)).not.toContain("example.com");
  });
});

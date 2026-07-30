import { describe, expect, it, vi } from "vitest";
import {
  classifyWebVitalRoute,
  createWebVitalReporter,
} from "../src/components/web-vitals-reporter";

describe("privacy-bounded Web Vitals reporter", () => {
  it("maps raw paths to fixed route classes without emitting slugs or queries", () => {
    expect(classifyWebVitalRoute("/zh-Hans")).toBe("homepage");
    expect(classifyWebVitalRoute("/en-US/jobs")).toBe("listing-list");
    expect(classifyWebVitalRoute("/en-US/jobs/irvine/private-listing-slug")).toBe("listing-detail");
    expect(classifyWebVitalRoute("/zh-Hans/search")).toBe("search");
    expect(classifyWebVitalRoute("/zh-Hans/account/listings")).toBe("account");
    expect(classifyWebVitalRoute("/zh-Hans/unknown/private-value")).toBe("other");
  });

  it("sends one sampled metric without cookies, identifiers, URLs or free-form data", async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 202 })));
    const report = createWebVitalReporter({
      pathname: () => "/en-US/jobs/irvine/private-listing-slug?q=private",
      random: () => 0,
      request,
      sampleRate: 0.1,
    });
    report({ name: "LCP", value: 2_450 });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe("/v1/performance/web-vitals");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "LCP",
      value: 2_450,
      route: "listing-detail",
    });
    expect(String(init?.body)).not.toContain("private-listing-slug");
    expect(String(init?.body)).not.toContain("q=private");
  });

  it("drops unsupported, invalid and unsampled metrics before network access", () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 202 })));
    const report = createWebVitalReporter({
      pathname: () => "/zh-Hans",
      random: () => 0.5,
      request,
      sampleRate: 0.1,
    });
    report({ name: "Next.js-hydration", value: 20 });
    report({ name: "CLS", value: Number.NaN });
    report({ name: "INP", value: 120 });
    expect(request).not.toHaveBeenCalled();
  });
});

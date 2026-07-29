import "@testing-library/jest-dom/vitest";
import type {
  ModerationActionResponse,
  ModerationCase,
  ModerationCaseCollection,
  ModerationCaseDetailResponse,
} from "@socal/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModerationWorkspace } from "../src/components/moderation-workspace";

const firstCaseId = "11111111-1111-4111-8111-111111111111";
const secondCaseId = "22222222-2222-4222-8222-222222222222";
const now = "2026-07-29T03:00:00.000Z";

function moderationCase(id: string, title: string, priority: number): ModerationCase {
  return {
    id,
    targetType: "LISTING",
    targetId: id,
    queue: "listing-submission",
    priority,
    riskTier: priority >= 80 ? "HIGH" : "MEDIUM",
    status: "OPEN",
    version: 1,
    listing: {
      id,
      type: "RENTAL",
      locale: "en-US",
      title,
      category: {
        id: "33333333-3333-4333-8333-333333333333",
        code: "rentals",
        nameZhHans: "房屋出租",
        nameEn: "Rentals",
      },
      region: {
        id: "44444444-4444-4444-8444-444444444444",
        code: "US-CA-LA",
        nameZhHans: "洛杉矶",
        nameEn: "Los Angeles",
      },
    },
    ruleCodes: ["EXTERNAL_PAYMENT_REQUEST"],
    slaDueAt: "2026-07-29T03:15:00.000Z",
    isSlaBreached: false,
    createdAt: now,
    updatedAt: now,
  };
}

const firstCase = moderationCase(firstCaseId, "Synthetic first rental", 80);
const secondCase = moderationCase(secondCaseId, "Synthetic second rental", 60);

function queue(items: readonly ModerationCase[]): ModerationCaseCollection {
  return {
    data: [...items],
    page: { hasMore: false, nextCursor: null },
    generatedAt: now,
  };
}

function detail(item: ModerationCase): ModerationCaseDetailResponse {
  return {
    data: {
      case: item,
      snapshot: {
        listingId: item.listing.id,
        listingVersion: 3,
        type: "RENTAL",
        locale: "en-US",
        title: item.listing.title,
        summary: "Synthetic summary",
        body: "Synthetic submission body for moderation testing.",
        price: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
        attributes: { bedrooms: 2 },
        contactMode: "IN_APP",
        locationPrecision: "NEIGHBORHOOD",
        mediaIds: [],
        category: item.listing.category,
        region: item.listing.region,
        formSchemaVersion: 1,
        defaultLifetimeDays: 30,
        sensitiveFieldsRedacted: true,
        previous: null,
        revision: null,
        capturedAt: now,
      },
      diff: [
        {
          field: "title",
          kind: "ADDED",
          before: null,
          after: item.listing.title,
        },
      ],
      rules: [
        {
          ruleCode: "EXTERNAL_PAYMENT_REQUEST",
          ruleVersion: 1,
          severity: "HIGH",
          evidenceKey: "body",
        },
      ],
      media: [],
      publisherHistory: {
        accountAgeDays: 40,
        submittedCount: 1,
        publishedCount: 0,
        rejectedCount: 0,
        suspendedCount: 0,
      },
      availableActions: ["APPROVE", "REQUEST_CHANGES", "REJECT"],
      reasonOptions: [
        { code: "CONTENT_POLICY_COMPLIANT", actions: ["APPROVE"] },
        { code: "NEEDS_CLARIFICATION", actions: ["REQUEST_CHANGES"] },
        { code: "PROHIBITED_CONTENT", actions: ["REJECT"] },
        { code: "EXTERNAL_PAYMENT_RISK", actions: ["REJECT"] },
      ],
      generatedAt: now,
      source: "POSTGRESQL",
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModerationWorkspace", () => {
  it("renders redacted source evidence and supports queue keyboard navigation", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(firstCaseId)) return Promise.resolve(jsonResponse(detail(firstCase)));
      if (url.includes(secondCaseId)) return Promise.resolve(jsonResponse(detail(secondCase)));
      return Promise.resolve(jsonResponse(queue([firstCase, secondCase])));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModerationWorkspace locale="en-US" canAct />);

    expect(await screen.findByRole("heading", { name: "Submission snapshot" })).toBeInTheDocument();
    expect(screen.getByText("Sensitive contact fields redacted")).toBeInTheDocument();
    expect(document.querySelector("footer")).toHaveTextContent("Source of truth: POSTGRESQL");
    fireEvent.keyDown(window, { key: "j" });
    expect(
      await screen.findByText("Synthetic second rental", { selector: "dd" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synthetic second rental/ })).toHaveFocus();
    fireEvent.keyDown(window, { key: "a", altKey: true });
    expect(screen.getByRole("combobox", { name: "Action" })).toHaveFocus();
  }, 10_000);

  it("requires step-up for writes and sends exact concurrency/idempotency headers when enabled", async () => {
    const actionResponse: ModerationActionResponse = {
      data: {
        caseId: firstCaseId,
        actionId: "55555555-5555-4555-8555-555555555555",
        action: "APPROVE",
        reasonCode: "CONTENT_POLICY_COMPLIANT",
        previousCaseStatus: "OPEN",
        currentCaseStatus: "RESOLVED",
        previousContentStatus: "SUBMITTED",
        currentContentStatus: "PUBLISHED",
        previousModerationStatus: "ESCALATED",
        currentModerationStatus: "APPROVED",
        caseVersion: 2,
        listingVersion: 4,
        occurredAt: now,
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(queue([firstCase])))
      .mockResolvedValueOnce(jsonResponse(detail(firstCase)))
      .mockResolvedValueOnce(jsonResponse(actionResponse))
      .mockResolvedValueOnce(jsonResponse(queue([])));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<ModerationWorkspace locale="en-US" canAct={false} />);
    expect(await screen.findByText(/Writes require MFA verified/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit decision" })).toBeDisabled();
    unmount();

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(queue([firstCase])))
      .mockResolvedValueOnce(jsonResponse(detail(firstCase)))
      .mockResolvedValueOnce(jsonResponse(actionResponse))
      .mockResolvedValueOnce(jsonResponse(queue([])));
    render(<ModerationWorkspace locale="en-US" canAct />);
    fireEvent.click(await screen.findByRole("button", { name: "Commit decision" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/v1/admin/moderation/cases/${firstCaseId}/actions`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "if-match": '"moderation-case-v1"',
          "idempotency-key": expect.stringMatching(/^admin-mod-/),
        }),
      }),
    );
    expect(
      await screen.findByText("No case matches the current queue filter."),
    ).toBeInTheDocument();
  });
});

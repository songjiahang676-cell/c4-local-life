import "@testing-library/jest-dom/vitest";
import type { MyListingCollection, MyListingSummaryView } from "@socal/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountListings, parseMyListingCollection } from "../src/components/account-listings";

const listing = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "RENTAL",
  bucket: "PUBLISHED",
  status: "PUBLISHED",
  moderationStatus: "AUTO_APPROVED",
  locale: "en-US",
  title: "Synthetic account listing",
  summary: "A fictional UI boundary fixture.",
  price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
  region: {
    id: "22222222-2222-4222-8222-222222222222",
    type: "CITY",
    code: "US-CA-IRVINE",
    slug: "irvine",
    nameZhHans: "测试城市",
    nameEn: "Synthetic Irvine",
    timezone: "America/Los_Angeles",
  },
  category: {
    id: "33333333-3333-4333-8333-333333333333",
    vertical: "RENTAL",
    slug: "rentals",
    nameZhHans: "测试租房",
    nameEn: "Synthetic rentals",
  },
  organization: null,
  isFeatured: false,
  publishedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-08-28T12:00:00.000Z",
  latestRevision: {
    revisionNumber: 1,
    classification: "SUBMISSION",
    reasonCodes: ["INITIAL_SUBMISSION"],
    reviewState: "APPROVED",
    createdAt: "2026-07-29T12:00:00.000Z",
  },
  availableActions: ["ARCHIVE", "VIEW_REVISIONS"],
  createdAt: "2026-07-29T11:00:00.000Z",
  updatedAt: "2026-07-29T12:00:00.000Z",
  version: 3,
} as const satisfies MyListingSummaryView;

function collection(
  data: readonly MyListingSummaryView[],
  counts: MyListingCollection["counts"] = {
    draft: 0,
    pending: 0,
    published: data.length,
    archived: 0,
  },
): MyListingCollection {
  return {
    data,
    page: { hasMore: false, nextCursor: null },
    counts,
    generatedAt: "2026-07-29T12:30:00.000Z",
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account Listing management", () => {
  it("shows an authentication gate without requesting private Listing data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountListings locale="en-US" />);

    expect(
      await screen.findByRole("heading", { name: "Sign in to manage listings" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/session",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("switches buckets and archives a selected current-version Listing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { user: { id: "owner" } } }))
      .mockResolvedValueOnce(
        jsonResponse(
          collection([], {
            draft: 1,
            pending: 0,
            published: 1,
            archived: 0,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          collection([listing], {
            draft: 1,
            pending: 0,
            published: 1,
            archived: 0,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              listingId: listing.id,
              outcome: "APPLIED",
              currentVersion: 4,
              currentBucket: "ARCHIVED",
            },
          ],
          appliedCount: 1,
          generatedAt: "2026-07-29T12:31:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          collection([], {
            draft: 1,
            pending: 0,
            published: 0,
            archived: 1,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountListings locale="en-US" />);

    fireEvent.click(await screen.findByRole("button", { name: /Published/ }));
    expect(await screen.findByRole("heading", { name: listing.title })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: `Select: ${listing.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));

    await waitFor(() => expect(screen.getByText("1 listings updated.")).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/me/listings/actions",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          action: "ARCHIVE",
          items: [{ listingId: listing.id, version: 3 }],
        }),
      }),
    );
  });

  it("rejects malformed and unbounded private responses before rendering", () => {
    expect(parseMyListingCollection(collection([listing]))).toEqual(collection([listing]));
    expect(
      parseMyListingCollection({
        ...collection([listing]),
        data: [{ ...listing, availableActions: ["RESET_DATABASE"] }],
      }),
    ).toBeNull();
    expect(
      parseMyListingCollection({
        ...collection([listing]),
        data: Array.from({ length: 51 }, () => listing),
      }),
    ).toBeNull();
    expect(
      parseMyListingCollection({
        ...collection([listing]),
        page: { hasMore: true, nextCursor: "x".repeat(513) },
      }),
    ).toBeNull();
  });
});

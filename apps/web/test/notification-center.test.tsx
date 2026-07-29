import "@testing-library/jest-dom/vitest";
import type { InAppNotification, NotificationCollection } from "@socal/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationCenter,
  parseNotificationCollection,
} from "../src/components/notification-center";

const notification = {
  id: "11111111-1111-4111-8111-111111111111",
  templateKey: "listing.published",
  templateVersion: 1,
  locale: "zh-Hans",
  title: "信息已发布",
  body: "您的出租信息已公开。",
  resource: {
    type: "LISTING",
    id: "22222222-2222-4222-8222-222222222222",
  },
  status: "UNREAD",
  createdAt: "2026-07-29T01:00:00.000Z",
  readAt: null,
} as const satisfies InAppNotification;

const collection = {
  data: [notification],
  pageInfo: { hasMore: false, nextCursor: null },
  unreadCount: 1,
  generatedAt: "2026-07-29T01:01:00.000Z",
} as const satisfies NotificationCollection;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notification center", () => {
  it("renders an account gate without requesting private notification data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationCenter locale="en-US" />);

    expect(
      await screen.findByRole("heading", { name: "Sign in to view notifications" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en-US/auth/login?returnTo=%2Fen-US%2Faccount%2Fnotifications",
    );
  });

  it("lists private notifications and marks an owned notification read", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { user: { id: "user" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(collection), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              ...notification,
              status: "READ",
              readAt: "2026-07-29T01:02:00.000Z",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationCenter locale="zh-Hans" />);

    expect(await screen.findByRole("heading", { name: "信息已发布" })).toBeVisible();
    expect(screen.getByText("1 条未读")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "标记为已读" }));

    await waitFor(() => expect(screen.getByText("0 条未读")).toBeVisible());
    expect(screen.queryByRole("button", { name: "标记为已读" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/v1/notifications/${notification.id}/read`,
      expect.objectContaining({ method: "PUT", credentials: "same-origin" }),
    );
  });

  it("rejects malformed or unbounded payloads before rendering", () => {
    expect(parseNotificationCollection(collection)).toEqual(collection);
    expect(
      parseNotificationCollection({
        ...collection,
        data: [
          {
            ...notification,
            resource: {
              ...notification.resource,
              type: "ORGANIZATION_INVITATION",
            },
          },
        ],
      }),
    ).not.toBeNull();
    expect(
      parseNotificationCollection({
        ...collection,
        data: [{ ...notification, body: { unsafe: true } }],
      }),
    ).toBeNull();
    expect(
      parseNotificationCollection({
        ...collection,
        data: [{ ...notification, resource: { ...notification.resource, type: "Listing" } }],
      }),
    ).toBeNull();
    expect(
      parseNotificationCollection({
        ...collection,
        pageInfo: { hasMore: true, nextCursor: "x".repeat(513) },
      }),
    ).toBeNull();
  });
});

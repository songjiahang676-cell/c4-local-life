import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountOverview } from "../src/components/account-overview";
import {
  AccountSessionProvider,
  AccountShell,
  parseAccountSessionResponse,
} from "../src/components/account-shell";

const sessionResponse = {
  data: {
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      displayName: "Synthetic Account Owner",
      avatarUrl: null,
      locale: "en-US",
      status: "ACTIVE",
      verificationBadges: ["synthetic-verified"],
    },
    expiresAt: "2099-07-30T01:00:00.000Z",
    permissions: ["account:listings:read", "listing:draft:create"],
    platformRoles: [],
    organizations: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "MERCHANT",
        displayName: "Synthetic Merchant",
        slug: "synthetic-merchant",
        role: "OWNER",
      },
    ],
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderAccount() {
  return render(
    <AccountSessionProvider>
      <AccountShell locale="en-US">
        <AccountOverview locale="en-US" />
      </AccountShell>
    </AccountSessionProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account shell", () => {
  it("rejects duplicated, malformed, and unbounded capability payloads", () => {
    expect(parseAccountSessionResponse(sessionResponse)).toEqual(sessionResponse);
    expect(
      parseAccountSessionResponse({
        data: {
          ...sessionResponse.data,
          permissions: ["account:listings:read", "account:listings:read"],
        },
      }),
    ).toBeNull();
    expect(
      parseAccountSessionResponse({
        data: {
          ...sessionResponse.data,
          permissions: ["platform-admin"],
        },
      }),
    ).toBeNull();
    expect(
      parseAccountSessionResponse({
        data: {
          ...sessionResponse.data,
          platformRoles: ["ROOT"],
        },
      }),
    ).toBeNull();
    expect(
      parseAccountSessionResponse({
        data: {
          ...sessionResponse.data,
          organizations: Array.from({ length: 51 }, () => sessionResponse.data.organizations[0]),
        },
      }),
    ).toBeNull();
  });

  it("renders only capability-scoped links from one no-store session snapshot", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sessionResponse));
    vi.stubGlobal("fetch", fetchMock);

    renderAccount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Welcome, Synthetic Account Owner" }),
    ).toBeVisible();
    const navigation = within(
      screen.getByRole("navigation", { name: "Account center navigation" }),
    );
    expect(navigation.getByRole("link", { name: "My listings" })).toHaveAttribute(
      "href",
      "/en-US/account/listings",
    );
    expect(navigation.getByRole("link", { name: "Post a listing" })).toHaveAttribute(
      "href",
      "/en-US/post/rental/new",
    );
    expect(navigation.queryByRole("link", { name: "Notifications" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/session",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("invalidates visible capabilities when a focus refresh returns 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(sessionResponse))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    renderAccount();

    expect((await screen.findAllByRole("link", { name: "My listings" }))[0]).toBeVisible();
    fireEvent.focus(window);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in to open your account" }),
    ).toBeVisible();
    expect(screen.queryAllByRole("link", { name: "My listings" })).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats an already expired server snapshot as unauthenticated", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          ...sessionResponse.data,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAccount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in to open your account" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Account center navigation" }),
    ).not.toBeInTheDocument();
  });

  it("fails closed on an unavailable session and supports an explicit retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("synthetic network failure"))
      .mockResolvedValueOnce(jsonResponse(sessionResponse));
    vi.stubGlobal("fetch", fetchMock);

    renderAccount();

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Welcome, Synthetic Account Owner" }),
      ).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GlobalSiteHeader,
  parseHeaderRegions,
  parseHeaderSuggestions,
} from "../src/components/global-site-header";

const generatedAt = "2026-08-02T03:00:00.000Z";
const regionResponse = {
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      parentId: null,
      code: "US-CA-IRVINE",
      type: "CITY",
      slug: "irvine",
      name: { "zh-Hans": "尔湾", "en-US": "Irvine" },
      timezone: "America/Los_Angeles",
      centroid: null,
      active: true,
      aliases: [],
      children: [],
    },
  ],
};

const suggestionResponse = {
  data: [
    { type: "QUERY", label: "rental", value: "rental", locale: "en-US" },
    { type: "CATEGORY", label: "Rentals", value: "rentals", locale: "en-US" },
    { type: "REGION", label: "Irvine", value: "US-CA-IRVINE", locale: "en-US" },
  ],
  generatedAt,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headerFetch(
  session: Response = jsonResponse({}, 401),
  suggestions: Response = jsonResponse(suggestionResponse),
) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/v1/auth/session") return session;
    if (url.pathname === "/v1/regions") {
      expect(url.searchParams.get("type")).toBe("CITY");
      expect(init).toMatchObject({ cache: "no-store", credentials: "omit" });
      return jsonResponse(regionResponse);
    }
    if (url.pathname === "/v1/search/suggestions") {
      expect(url.searchParams.get("locale")).toBe("en-US");
      expect(url.searchParams.get("limit")).toBe("8");
      expect(init).toMatchObject({ cache: "no-store", credentials: "omit" });
      return suggestions.clone();
    }
    return jsonResponse({}, 404);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("global site header", () => {
  it("fails closed on malformed, duplicated, wrong-locale, or unsafe discovery payloads", () => {
    expect(parseHeaderSuggestions(suggestionResponse, "en-US")).toEqual(suggestionResponse.data);
    expect(parseHeaderSuggestions({ ...suggestionResponse, extra: "drift" }, "en-US")).toBeNull();
    expect(
      parseHeaderSuggestions(
        { ...suggestionResponse, data: [suggestionResponse.data[0], suggestionResponse.data[0]] },
        "en-US",
      ),
    ).toBeNull();
    expect(
      parseHeaderSuggestions(
        {
          ...suggestionResponse,
          data: [{ ...suggestionResponse.data[0], locale: "zh-Hans" }],
        },
        "en-US",
      ),
    ).toBeNull();
    expect(parseHeaderRegions(regionResponse, "en-US")).toEqual([
      { code: "US-CA-IRVINE", name: "Irvine" },
    ]);
    expect(
      parseHeaderRegions(
        {
          data: [
            {
              ...regionResponse.data[0]!,
              name: { ...regionResponse.data[0]!.name, "en-US": "Unsafe\u202eCity" },
            },
          ],
        },
        "en-US",
      ),
    ).toBeNull();
  });

  it("loads public regions without cookies and supports keyboard search suggestions", async () => {
    const fetchMock = headerFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<GlobalSiteHeader locale="en-US" pathname="/en-US/rentals" />);

    expect(screen.getByRole("link", { name: "SoCal Life home" })).toHaveAttribute("href", "/en-US");
    expect(screen.getByRole("link", { name: "Rentals" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "中文 / English" })).toHaveAttribute(
      "href",
      "/zh-Hans/rentals",
    );

    const region = screen.getByRole("combobox", { name: "Choose search region" });
    await waitFor(() =>
      expect(within(region).getByRole("option", { name: "Irvine" })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "Register" })).toBeVisible());
    fireEvent.change(region, { target: { value: "US-CA-IRVINE" } });

    const search = screen.getByRole("combobox", { name: "Search" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "rent" } });
    const listbox = await screen.findByRole("listbox", { name: "Search suggestions" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("rental");
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Search suggestions" })).not.toBeInTheDocument(),
    );

    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "Irv" } });
    const nextListbox = await screen.findByRole("listbox", { name: "Search suggestions" });
    const regionSuggestion = within(nextListbox).getByText("Irvine");
    fireEvent.mouseDown(regionSuggestion);
    fireEvent.click(regionSuggestion);
    expect(region).toHaveValue("US-CA-IRVINE");
    expect(search).toHaveValue("");

    const publicRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/v1/search/suggestions"),
    );
    expect(publicRequests.length).toBeGreaterThanOrEqual(2);
    expect(publicRequests.at(-1)?.[0]).toContain("regionCode=US-CA-IRVINE");
  });

  it("shows only the generic account entry after a strict active session response", async () => {
    const fetchMock = headerFetch(
      jsonResponse({
        data: {
          user: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            displayName: "Synthetic Account Owner",
            avatarUrl: null,
            locale: "en-US",
            status: "ACTIVE",
            verificationBadges: [],
          },
          expiresAt: "2099-08-02T03:00:00.000Z",
          permissions: ["account:listings:read"],
          platformRoles: [],
          organizations: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<GlobalSiteHeader locale="en-US" pathname="/en-US" />);

    expect(await screen.findByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/en-US/account",
    );
    expect(screen.queryByText("Synthetic Account Owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register" })).not.toBeInTheDocument();
    const sessionCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/v1/auth/session"),
    );
    expect(sessionCall?.[1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("shows an honest suggestion failure and closes it with Escape", async () => {
    vi.stubGlobal("fetch", headerFetch(jsonResponse({}, 401), jsonResponse({}, 503)));
    render(<GlobalSiteHeader locale="zh-Hans" pathname="/zh-Hans" />);

    const search = screen.getByRole("combobox", { name: "搜索" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "租房" } });
    await waitFor(() =>
      expect(document.querySelector(".globalSearchState")).toHaveTextContent(
        "搜索建议暂不可用，可直接提交搜索",
      ),
    );
    fireEvent.keyDown(search, { key: "Escape" });
    expect(document.querySelector(".globalSearchState")).not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminConsole } from "../src/components/admin-console";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminConsole", () => {
  it("renders only API-authorized navigation and no fabricated operational metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              operator: {
                id: "10000000-0000-4000-8000-000000000001",
                displayName: "Synthetic Moderator",
                avatarUrl: null,
                locale: "zh-Hans",
                status: "ACTIVE",
                verificationBadges: [],
              },
              roles: ["MODERATOR"],
              navigation: [{ key: "moderation", href: "/admin/moderation/listings" }],
              security: { mfaRequired: true, privilegedActionsAllowed: false },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<AdminConsole activePath="/admin" />);

    expect(await screen.findByRole("heading", { level: 1, name: "访问概览" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "内容审核" })).toHaveAttribute(
      "href",
      "/admin/moderation/listings",
    );
    expect(screen.queryByRole("link", { name: "订单与财务" })).not.toBeInTheDocument();
    expect(screen.getByText("MFA 安全门尚未完成")).toBeInTheDocument();
    expect(screen.queryByText("126")).not.toBeInTheDocument();
  });

  it("shows a generic access-denied state without rendering role navigation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    render(<AdminConsole activePath="/admin" />);

    expect(await screen.findByRole("heading", { name: "无后台访问权限" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("SUPPORT")).not.toBeInTheDocument();
  });

  it("offers the localized OTP login form only for an unauthenticated session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(<AdminConsole activePath="/admin" />);

    expect(await screen.findByRole("heading", { name: "运营人员登录" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "工作邮箱" })).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByRole("button", { name: "发送验证码" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "语言" }), {
      target: { value: "en-US" },
    });
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.title).toBe("Admin Console | SoCal Life");
    expect(screen.getByRole("heading", { name: "Operator sign in" })).toBeInTheDocument();
  });
});

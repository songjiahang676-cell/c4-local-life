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
              security: {
                mfaRequired: true,
                mfaEnrolled: true,
                authenticationStrength: "MFA",
                mfaVerifiedAt: "2026-07-28T20:00:00.000Z",
                stepUpExpiresAt: "2026-07-28T20:10:00.000Z",
                privilegedActionsAllowed: true,
                sensitiveActionsAllowed: true,
              },
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
    expect(screen.getByText("双重验证已启用")).toBeInTheDocument();
    expect(screen.queryByText("126")).not.toBeInTheDocument();
  });

  it("shows queue evidence to read-only auditors without enabling mutation controls", async () => {
    const queueEvidence = {
      data: [],
      page: { hasMore: false, nextCursor: null },
      generatedAt: "2026-08-01T08:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              operator: {
                id: "10000000-0000-4000-8000-000000000002",
                displayName: "Synthetic Auditor",
                avatarUrl: null,
                locale: "en-US",
                status: "ACTIVE",
                verificationBadges: [],
              },
              roles: ["READ_ONLY_AUDITOR"],
              navigation: [
                { key: "system", href: "/admin/system/health" },
                { key: "audit", href: "/admin/audit" },
              ],
              security: {
                mfaRequired: true,
                mfaEnrolled: true,
                authenticationStrength: "MFA",
                mfaVerifiedAt: "2026-08-01T08:00:00.000Z",
                stepUpExpiresAt: "2026-08-01T08:10:00.000Z",
                privilegedActionsAllowed: true,
                sensitiveActionsAllowed: true,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(queueEvidence), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole activePath="/admin/system/health" />);

    expect(await screen.findByRole("heading", { name: "队列恢复与对账" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建重放批次" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建对账任务" })).toBeDisabled();
  });

  it("blocks role navigation behind required MFA enrollment", async () => {
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
              security: {
                mfaRequired: true,
                mfaEnrolled: false,
                authenticationStrength: "PRIMARY",
                mfaVerifiedAt: null,
                stepUpExpiresAt: null,
                privilegedActionsAllowed: false,
                sensitiveActionsAllowed: false,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<AdminConsole activePath="/admin" />);

    expect(await screen.findByRole("heading", { name: "设置后台双重验证" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始设置" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("completes the accessible enrollment UI and shows recovery codes once", async () => {
    const sessionPayload = {
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
        security: {
          mfaRequired: true,
          mfaEnrolled: false,
          authenticationStrength: "PRIMARY",
          mfaVerifiedAt: null,
          stepUpExpiresAt: null,
          privilegedActionsAllowed: false,
          sensitiveActionsAllowed: false,
        },
      },
    };
    const recoveryCodes = Array.from(
      { length: 10 },
      (_value, index) => `AAAA-BBBB-CCCC-${String(index).padStart(4, "2").replaceAll("0", "A")}`,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sessionPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              credentialId: "20000000-0000-4000-8000-000000000001",
              secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
              otpauthUri: "otpauth://totp/example",
              expiresAt: "2026-07-28T21:00:00.000Z",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              recoveryCodes,
              mfaVerifiedAt: "2026-07-28T20:00:00.000Z",
              stepUpExpiresAt: "2026-07-28T20:10:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole activePath="/admin" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始设置" }));
    expect(await screen.findByText("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "身份验证器验证码" }), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启用双重验证" }));

    expect(await screen.findByRole("heading", { name: "立即保存恢复码" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/v1/admin/mfa/enrollment/verify",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
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

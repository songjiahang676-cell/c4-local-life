"use client";

import type { AdminSessionResponse } from "@socal/contracts";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Locale = "zh-Hans" | "en-US";
type SessionState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "ready"; session: AdminSessionResponse["data"] };

type OtpChallenge = {
  challengeId: string;
  expiresAt: string;
};

export const knownAdminPaths = new Set([
  "/admin/moderation/listings",
  "/admin/users",
  "/admin/taxonomy/categories",
  "/admin/commerce/orders",
  "/admin/ads/campaigns",
  "/admin/audit",
  "/admin/system/health",
]);

const copy = {
  "zh-Hans": {
    pageTitle: "管理后台 | 南加生活网",
    brand: "南加生活网",
    admin: "管理后台",
    loading: "正在验证运营人员权限…",
    signInTitle: "运营人员登录",
    signInIntro: "使用已获授权的员工账号接收一次性验证码。",
    email: "工作邮箱",
    requestCode: "发送验证码",
    code: "六位验证码",
    verify: "验证并登录",
    expires: "验证码有效至",
    deniedTitle: "无后台访问权限",
    deniedBody: "当前账号没有有效的平台角色。若这是工作账号，请联系平台管理员核对授权。",
    serviceErrorTitle: "后台暂时不可用",
    serviceErrorBody: "无法验证权限。请稍后重试，或联系值班人员。",
    retry: "重试",
    signOut: "退出",
    securityTitle: "MFA 安全门尚未完成",
    securityBody: "AUTH-005 完成前，当前界面只显示角色与导航骨架，不开放任何特权数据或写操作。",
    overview: "访问概览",
    overviewBody: "以下工作区由服务端根据当前有效平台角色计算。未授权入口不会显示。",
    empty: "当前角色没有可见工作区。",
    placeholder: "工作区尚未启用",
    placeholderBody: "此垂直切片只交付安全壳层。真实数据与操作将在对应 Backlog 任务完成后接入。",
    roles: "当前角色",
    language: "语言",
    nav: {
      moderation: "内容审核",
      people: "用户与组织",
      taxonomy: "分类与配置",
      commerce: "订单与财务",
      ads: "广告运营",
      audit: "审计日志",
      system: "系统状态",
    },
  },
  "en-US": {
    pageTitle: "Admin Console | SoCal Life",
    brand: "SoCal Life",
    admin: "Admin Console",
    loading: "Verifying operator access…",
    signInTitle: "Operator sign in",
    signInIntro: "Use an authorized staff account to receive a one-time code.",
    email: "Work email",
    requestCode: "Send code",
    code: "Six-digit code",
    verify: "Verify and sign in",
    expires: "Code expires",
    deniedTitle: "No Admin access",
    deniedBody:
      "This account has no active platform role. Ask a platform administrator to verify the grant.",
    serviceErrorTitle: "Admin is temporarily unavailable",
    serviceErrorBody: "Access could not be verified. Retry later or contact the operator on call.",
    retry: "Retry",
    signOut: "Sign out",
    securityTitle: "MFA security gate is pending",
    securityBody:
      "Until AUTH-005 ships, this shell exposes only role and navigation metadata—no privileged data or writes.",
    overview: "Access overview",
    overviewBody:
      "The API computes these workspaces from current platform roles. Unauthorized entries are omitted.",
    empty: "No workspace is available for the current roles.",
    placeholder: "Workspace not enabled",
    placeholderBody:
      "This slice delivers the secure shell only. Real data and actions arrive with the owning Backlog task.",
    roles: "Current roles",
    language: "Language",
    nav: {
      moderation: "Moderation",
      people: "Users & organizations",
      taxonomy: "Taxonomy & config",
      commerce: "Orders & finance",
      ads: "Ad operations",
      audit: "Audit log",
      system: "System health",
    },
  },
} as const;

async function readAdminSession(): Promise<SessionState> {
  try {
    const response = await fetch("/v1/admin/session", {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) return { kind: "signed-out" };
    if (response.status === 403) return { kind: "denied" };
    if (!response.ok) return { kind: "error" };
    return {
      kind: "ready",
      session: ((await response.json()) as AdminSessionResponse).data,
    };
  } catch {
    return { kind: "error" };
  }
}

export function AdminConsole({ activePath }: { activePath: string }) {
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const deviceId = useRef<string | null>(null);
  const text = copy[locale];

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await readAdminSession());
  }, []);

  useEffect(() => {
    let current = true;

    void readAdminSession().then((nextState) => {
      if (current) {
        setState(nextState);
      }
    });

    return () => {
      current = false;
    };
  }, []);

  function currentDeviceId(): string {
    deviceId.current ??= `admin-web-${crypto.randomUUID()}`;
    return deviceId.current;
  }

  function changeLocale(nextLocale: Locale): void {
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    document.title = copy[nextLocale].pageTitle;
  }

  async function requestCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch("/v1/auth/otp/request", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-device-id": currentDeviceId(),
        },
        body: JSON.stringify({
          channel: "EMAIL",
          destination: email,
          purpose: "SIGN_IN",
          locale,
        }),
      });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      setChallenge((await response.json()) as OtpChallenge);
    } catch {
      setState({ kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge) return;
    setSubmitting(true);
    try {
      const response = await fetch("/v1/auth/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-device-id": currentDeviceId(),
        },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      if (!response.ok) {
        setState({ kind: response.status === 403 ? "denied" : "error" });
        return;
      }
      setChallenge(null);
      setCode("");
      await refresh();
    } catch {
      setState({ kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut(): Promise<void> {
    await fetch("/v1/auth/session", {
      method: "DELETE",
      credentials: "include",
      headers: { origin: window.location.origin },
    }).catch(() => undefined);
    setState({ kind: "signed-out" });
  }

  const languageControl = (
    <label className="languageControl">
      <span>{text.language}</span>
      <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>
        <option value="zh-Hans">简体中文</option>
        <option value="en-US">English</option>
      </select>
    </label>
  );

  if (state.kind === "loading") {
    return (
      <main className="statePage">
        {languageControl}
        <p role="status">{text.loading}</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard" aria-labelledby="service-error-title">
          <h1 id="service-error-title">{text.serviceErrorTitle}</h1>
          <p>{text.serviceErrorBody}</p>
          <button type="button" onClick={() => void refresh()}>
            {text.retry}
          </button>
        </section>
      </main>
    );
  }

  if (state.kind === "denied") {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard denied" aria-labelledby="denied-title">
          <h1 id="denied-title">{text.deniedTitle}</h1>
          <p>{text.deniedBody}</p>
          <button type="button" onClick={() => void signOut()}>
            {text.signOut}
          </button>
        </section>
      </main>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard signInCard" aria-labelledby="sign-in-title">
          <div className="brandMark" aria-hidden="true">
            南
          </div>
          <p className="eyebrow">{text.brand}</p>
          <h1 id="sign-in-title">{text.signInTitle}</h1>
          <p>{text.signInIntro}</p>
          {!challenge ? (
            <form onSubmit={(event) => void requestCode(event)}>
              <label>
                <span>{text.email}</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button type="submit" disabled={submitting}>
                {text.requestCode}
              </button>
            </form>
          ) : (
            <form onSubmit={(event) => void verifyCode(event)}>
              <label>
                <span>{text.code}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <small>
                {text.expires}: {new Date(challenge.expiresAt).toLocaleTimeString(locale)}
              </small>
              <button type="submit" disabled={submitting}>
                {text.verify}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  const session = state.session;
  const activeNavigation = session.navigation.find((item) => item.href === activePath);
  return (
    <div className="adminShell">
      <aside>
        <Link className="adminBrand" href="/admin" aria-label={`${text.brand} ${text.admin}`}>
          <span className="brandMark" aria-hidden="true">
            南
          </span>
          <span>
            <strong>{text.brand}</strong>
            <small>{text.admin}</small>
          </span>
        </Link>
        <nav aria-label={text.admin}>
          {session.navigation.map((item) => (
            <a
              className={item.href === activePath ? "active" : undefined}
              aria-current={item.href === activePath ? "page" : undefined}
              href={item.href}
              key={item.key}
            >
              {text.nav[item.key]}
            </a>
          ))}
        </nav>
      </aside>
      <main className="adminContent">
        <header className="adminHeader">
          <div>
            <p className="eyebrow">
              {activeNavigation ? text.nav[activeNavigation.key] : text.admin}
            </p>
            <h1>{activeNavigation ? text.placeholder : text.overview}</h1>
          </div>
          <div className="operator">
            {languageControl}
            <span>{session.operator.displayName}</span>
            <button type="button" onClick={() => void signOut()}>
              {text.signOut}
            </button>
          </div>
        </header>
        <section className="securityNotice" aria-labelledby="security-title">
          <strong id="security-title">{text.securityTitle}</strong>
          <p>{text.securityBody}</p>
        </section>
        <div className="adminGrid">
          <section className="panel">
            <h2>{activeNavigation ? text.placeholder : text.overview}</h2>
            <p>{activeNavigation ? text.placeholderBody : text.overviewBody}</p>
            {!activeNavigation && session.navigation.length === 0 ? <p>{text.empty}</p> : null}
          </section>
          <section className="panel">
            <h2>{text.roles}</h2>
            <ul className="roleList">
              {session.roles.map((role) => (
                <li key={role}>{role.replaceAll("_", " ")}</li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}

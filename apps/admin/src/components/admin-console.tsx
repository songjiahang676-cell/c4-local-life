"use client";

import type {
  AdminMfaActivationResponse,
  AdminMfaEnrollmentResponse,
  AdminSessionResponse,
} from "@socal/contracts";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ModerationWorkspace } from "./moderation-workspace";

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

type MfaEnrollment = AdminMfaEnrollmentResponse["data"];

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
    mfaEnrollTitle: "设置后台双重验证",
    mfaEnrollIntro: "后台访问必须使用身份验证器。密钥和恢复码只会在设置过程中显示。",
    beginEnrollment: "开始设置",
    setupKey: "身份验证器设置密钥",
    setupInstructions: "在身份验证器中添加此密钥，然后输入当前六位动态验证码。",
    copyKey: "复制密钥",
    keyCopied: "已复制",
    mfaCode: "身份验证器验证码",
    activateMfa: "启用双重验证",
    mfaVerifyTitle: "完成后台双重验证",
    mfaVerifyIntro: "输入身份验证器的六位动态验证码，或使用一枚未使用的恢复码。",
    recoveryOrCode: "动态验证码或恢复码",
    verifyMfa: "验证并进入后台",
    mfaError: "验证失败或已过期，请检查后重试。",
    mfaLocked: "尝试次数过多，请稍后重试。",
    recoveryTitle: "立即保存恢复码",
    recoveryIntro: "每枚恢复码只能使用一次。请存入受保护的密码管理器；离开此页后不会再次显示。",
    recoverySaved: "我已安全保存",
    securityTitle: "双重验证已启用",
    securityBody: "当前后台会话已通过 MFA。敏感操作仍要求近期验证。",
    stepUpExpired: "近期验证已过期；执行敏感操作前请再次验证。",
    stepUpValid: "近期验证有效，可执行当前角色允许的敏感操作。",
    verifyAgain: "再次验证",
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
    mfaEnrollTitle: "Set up Admin two-factor authentication",
    mfaEnrollIntro:
      "Admin access requires an authenticator app. The setup secret and recovery codes are shown only during enrollment.",
    beginEnrollment: "Begin setup",
    setupKey: "Authenticator setup key",
    setupInstructions:
      "Add this key to your authenticator app, then enter its current six-digit code.",
    copyKey: "Copy key",
    keyCopied: "Copied",
    mfaCode: "Authenticator code",
    activateMfa: "Enable two-factor authentication",
    mfaVerifyTitle: "Complete Admin two-factor authentication",
    mfaVerifyIntro: "Enter the current six-digit authenticator code or one unused recovery code.",
    recoveryOrCode: "Authenticator or recovery code",
    verifyMfa: "Verify and enter Admin",
    mfaError: "Verification failed or expired. Check the code and try again.",
    mfaLocked: "Too many attempts. Try again later.",
    recoveryTitle: "Save your recovery codes now",
    recoveryIntro:
      "Each recovery code works once. Store them in a protected password manager; they are not shown again.",
    recoverySaved: "I saved them securely",
    securityTitle: "Two-factor authentication enabled",
    securityBody:
      "This Admin session is MFA-bound. Sensitive actions still require recent verification.",
    stepUpExpired: "Recent verification expired. Verify again before a sensitive action.",
    stepUpValid: "Recent verification is valid for sensitive actions allowed by your role.",
    verifyAgain: "Verify again",
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
  const [mfaEnrollment, setMfaEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<"invalid" | "locked" | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [copied, setCopied] = useState(false);
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

  async function beginMfaEnrollment(): Promise<void> {
    setSubmitting(true);
    setMfaError(null);
    try {
      const response = await fetch("/v1/admin/mfa/enrollment", {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        setMfaError(response.status === 429 ? "locked" : "invalid");
        return;
      }
      setMfaEnrollment(((await response.json()) as AdminMfaEnrollmentResponse).data);
      setMfaCode("");
    } catch {
      setMfaError("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  async function activateMfa(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!mfaEnrollment) return;
    setSubmitting(true);
    setMfaError(null);
    try {
      const response = await fetch("/v1/admin/mfa/enrollment/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          credentialId: mfaEnrollment.credentialId,
          code: mfaCode,
        }),
      });
      if (!response.ok) {
        setMfaError(response.status === 429 ? "locked" : "invalid");
        return;
      }
      const activation = ((await response.json()) as AdminMfaActivationResponse).data;
      setRecoveryCodes(activation.recoveryCodes);
      setMfaEnrollment(null);
      setMfaCode("");
    } catch {
      setMfaError("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMfaError(null);
    try {
      const response = await fetch("/v1/admin/mfa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ code: mfaCode.trim().toUpperCase() }),
      });
      if (!response.ok) {
        setMfaError(response.status === 429 ? "locked" : "invalid");
        return;
      }
      setMfaCode("");
      await refresh();
    } catch {
      setMfaError("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyMfaKey(): Promise<void> {
    if (!mfaEnrollment) return;
    try {
      await navigator.clipboard.writeText(mfaEnrollment.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
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
  const mfaErrorMessage =
    mfaError === "locked" ? text.mfaLocked : mfaError === "invalid" ? text.mfaError : null;

  if (recoveryCodes) {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard mfaCard" aria-labelledby="recovery-title">
          <p className="eyebrow">{text.admin}</p>
          <h1 id="recovery-title">{text.recoveryTitle}</h1>
          <p>{text.recoveryIntro}</p>
          <ul className="recoveryCodes" aria-label={text.recoveryTitle}>
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>
                <code>{recoveryCode}</code>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setRecoveryCodes(null);
              void refresh();
            }}
          >
            {text.recoverySaved}
          </button>
        </section>
      </main>
    );
  }

  if (!session.security.mfaEnrolled) {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard mfaCard" aria-labelledby="mfa-enroll-title">
          <p className="eyebrow">{text.admin}</p>
          <h1 id="mfa-enroll-title">{text.mfaEnrollTitle}</h1>
          <p>{text.mfaEnrollIntro}</p>
          {!mfaEnrollment ? (
            <button type="button" disabled={submitting} onClick={() => void beginMfaEnrollment()}>
              {text.beginEnrollment}
            </button>
          ) : (
            <>
              <p>{text.setupInstructions}</p>
              <div className="setupKey">
                <span>{text.setupKey}</span>
                <code>{mfaEnrollment.secret}</code>
                <button type="button" onClick={() => void copyMfaKey()}>
                  {copied ? text.keyCopied : text.copyKey}
                </button>
              </div>
              <form onSubmit={(event) => void activateMfa(event)}>
                <label>
                  <span>{text.mfaCode}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={submitting}>
                  {text.activateMfa}
                </button>
              </form>
            </>
          )}
          {mfaErrorMessage ? <p role="alert">{mfaErrorMessage}</p> : null}
          <button className="secondaryButton" type="button" onClick={() => void signOut()}>
            {text.signOut}
          </button>
        </section>
      </main>
    );
  }

  if (session.security.authenticationStrength !== "MFA") {
    return (
      <main className="statePage">
        {languageControl}
        <section className="stateCard mfaCard" aria-labelledby="mfa-verify-title">
          <p className="eyebrow">{text.admin}</p>
          <h1 id="mfa-verify-title">{text.mfaVerifyTitle}</h1>
          <p>{text.mfaVerifyIntro}</p>
          <form onSubmit={(event) => void verifyMfa(event)}>
            <label>
              <span>{text.recoveryOrCode}</span>
              <input
                type="text"
                autoComplete="one-time-code"
                pattern="(?:[0-9]{6}|[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3})"
                minLength={6}
                maxLength={19}
                required
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value.toUpperCase())}
              />
            </label>
            <button type="submit" disabled={submitting}>
              {text.verifyMfa}
            </button>
          </form>
          {mfaErrorMessage ? <p role="alert">{mfaErrorMessage}</p> : null}
          <button className="secondaryButton" type="button" onClick={() => void signOut()}>
            {text.signOut}
          </button>
        </section>
      </main>
    );
  }

  const activeNavigation = session.navigation.find((item) => item.href === activePath);
  const moderationActive =
    activeNavigation?.key === "moderation" && activePath === "/admin/moderation/listings";
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
            <h1>
              {moderationActive
                ? text.nav.moderation
                : activeNavigation
                  ? text.placeholder
                  : text.overview}
            </h1>
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
          <p>{session.security.sensitiveActionsAllowed ? text.stepUpValid : text.stepUpExpired}</p>
          {!session.security.sensitiveActionsAllowed ? (
            <form className="stepUpForm" onSubmit={(event) => void verifyMfa(event)}>
              <label>
                <span>{text.recoveryOrCode}</span>
                <input
                  type="text"
                  autoComplete="one-time-code"
                  pattern="(?:[0-9]{6}|[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3})"
                  minLength={6}
                  maxLength={19}
                  required
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.toUpperCase())}
                />
              </label>
              <button type="submit" disabled={submitting}>
                {text.verifyAgain}
              </button>
              {mfaErrorMessage ? <span role="alert">{mfaErrorMessage}</span> : null}
            </form>
          ) : null}
        </section>
        {moderationActive ? (
          <ModerationWorkspace locale={locale} canAct={session.security.sensitiveActionsAllowed} />
        ) : (
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
        )}
      </main>
    </div>
  );
}

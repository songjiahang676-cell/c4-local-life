"use client";

import type {
  ModerationActionRequest,
  ModerationActionResponse,
  ModerationCase,
  ModerationCaseCollection,
  ModerationCaseDetailResponse,
} from "@socal/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Locale = "zh-Hans" | "en-US";
type ModerationAction = ModerationActionRequest["action"];
type ReasonCode = ModerationActionRequest["reasonCode"];

const copy = {
  "zh-Hans": {
    title: "Listing 审核工作台",
    intro: "按风险优先级与 SLA 查看 PostgreSQL 事实源；所有内容均为提交时的不可变快照。",
    refresh: "刷新队列",
    loading: "正在读取审核队列…",
    empty: "当前筛选下没有待审核案件。",
    error: "审核数据暂时不可用，请重试。",
    queue: "待审核队列",
    priority: "优先级",
    due: "SLA 截止",
    breached: "已超时",
    generated: "数据时间",
    keyboard: "键盘：J/↓ 下一条，K/↑ 上一条，R 刷新，Alt+A 聚焦动作。",
    detail: "提交快照",
    diff: "与上次发布版本的差异",
    firstSubmission: "首次提交；无历史发布快照，字段均标记为新增。",
    rules: "规则证据",
    noRules: "没有规则命中。",
    publisher: "发布者历史摘要",
    accountAge: "账号年龄（天）",
    submitted: "已提交 Listing",
    published: "已发布",
    rejected: "被拒绝",
    suspended: "被暂停",
    media: "媒体扫描",
    noMedia: "本次提交没有媒体。",
    actionTitle: "处置",
    action: "动作",
    reason: "标准原因",
    note: "内部备注（可选）",
    submit: "提交处置",
    stepUp: "写操作需要十分钟内的 MFA 再验证；请先使用页面顶部的验证表单。",
    actionSuccess: "处置已提交并写入审计。",
    actionConflict: "案件已被其他审核员更新，已刷新最新状态。",
    actionError: "处置失败，请检查状态后重试。",
    source: "事实源",
    redacted: "敏感联系方式已遮罩",
    actions: {
      APPROVE: "批准发布",
      REQUEST_CHANGES: "要求修改",
      REJECT: "拒绝并暂停",
      ESCALATE: "升级复核",
    },
    reasons: {
      CONTENT_POLICY_COMPLIANT: "符合内容政策",
      NEEDS_CLARIFICATION: "需要补充或澄清",
      PROHIBITED_CONTENT: "禁止内容",
      EXTERNAL_PAYMENT_RISK: "平台外付款风险",
      ESCALATE_SENIOR_REVIEW: "升级高级审核",
    },
  },
  "en-US": {
    title: "Listing moderation workbench",
    intro:
      "Review the PostgreSQL source of truth by risk priority and SLA. Content is the immutable submission snapshot.",
    refresh: "Refresh queue",
    loading: "Loading moderation queue…",
    empty: "No case matches the current queue filter.",
    error: "Moderation data is temporarily unavailable. Retry.",
    queue: "Review queue",
    priority: "Priority",
    due: "SLA due",
    breached: "Overdue",
    generated: "Data time",
    keyboard: "Keyboard: J/↓ next, K/↑ previous, R refresh, Alt+A focus action.",
    detail: "Submission snapshot",
    diff: "Diff from previous published version",
    firstSubmission: "First submission; no earlier published snapshot, so every field is added.",
    rules: "Rule evidence",
    noRules: "No rule hit.",
    publisher: "Publisher history summary",
    accountAge: "Account age (days)",
    submitted: "Submitted listings",
    published: "Published",
    rejected: "Rejected",
    suspended: "Suspended",
    media: "Media scanning",
    noMedia: "No media in this submission.",
    actionTitle: "Decision",
    action: "Action",
    reason: "Standard reason",
    note: "Internal note (optional)",
    submit: "Commit decision",
    stepUp:
      "Writes require MFA verified within ten minutes. Use the verification form above first.",
    actionSuccess: "Decision committed with audit evidence.",
    actionConflict: "Another moderator changed this case. The latest state was loaded.",
    actionError: "Decision failed. Review the current state and retry.",
    source: "Source of truth",
    redacted: "Sensitive contact fields redacted",
    actions: {
      APPROVE: "Approve",
      REQUEST_CHANGES: "Request changes",
      REJECT: "Reject and suspend",
      ESCALATE: "Escalate",
    },
    reasons: {
      CONTENT_POLICY_COMPLIANT: "Content policy compliant",
      NEEDS_CLARIFICATION: "Needs clarification",
      PROHIBITED_CONTENT: "Prohibited content",
      EXTERNAL_PAYMENT_RISK: "Off-platform payment risk",
      ESCALATE_SENIOR_REVIEW: "Escalate to senior review",
    },
  },
} as const;

function displayTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function displayValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ModerationWorkspace({ locale, canAct }: { locale: Locale; canAct: boolean }) {
  const text = copy[locale];
  const [cases, setCases] = useState<readonly ModerationCase[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModerationCaseDetailResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [action, setAction] = useState<ModerationAction>("APPROVE");
  const [reasonCode, setReasonCode] = useState<ReasonCode>("CONTENT_POLICY_COMPLIANT");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "conflict" | "error" | null>(null);
  const caseButtons = useRef(new Map<string, HTMLButtonElement>());
  const actionSelect = useRef<HTMLSelectElement | null>(null);
  const actionAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadDetail = useCallback(async (caseId: string): Promise<void> => {
    try {
      const response = await fetch(`/v1/admin/moderation/cases/${caseId}`, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("detail");
      const payload = (await response.json()) as ModerationCaseDetailResponse;
      setDetail(payload.data);
      const firstAction = payload.data.availableActions[0];
      if (firstAction) {
        setAction(firstAction);
        const reason = payload.data.reasonOptions.find((option) =>
          option.actions.includes(firstAction),
        )?.code;
        if (reason) setReasonCode(reason);
      }
    } catch {
      setDetail(null);
      setLoadError(true);
    }
  }, []);

  const loadQueue = useCallback(
    async (preferredId?: string): Promise<void> => {
      setLoading(true);
      setLoadError(false);
      try {
        const response = await fetch(
          "/v1/admin/moderation/cases?queue=listing-submission&status=OPEN&limit=20",
          {
            credentials: "include",
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        if (!response.ok) throw new Error("queue");
        const payload = (await response.json()) as ModerationCaseCollection;
        setCases(payload.data);
        setGeneratedAt(payload.generatedAt);
        const nextId =
          payload.data.find((item) => item.id === preferredId)?.id ?? payload.data[0]?.id ?? null;
        setSelectedId(nextId);
        if (nextId) {
          await loadDetail(nextId);
        } else {
          setDetail(null);
        }
      } catch {
        setCases([]);
        setDetail(null);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [loadDetail],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  const selectCase = useCallback(
    (caseId: string, focus = false): void => {
      setSelectedId(caseId);
      setFeedback(null);
      void loadDetail(caseId).then(() => {
        if (focus) caseButtons.current.get(caseId)?.focus();
      });
    },
    [loadDetail],
  );

  useLayoutEffect(() => {
    function keyboard(event: KeyboardEvent): void {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        actionSelect.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void loadQueue(selectedId ?? undefined);
        return;
      }
      const delta =
        event.key === "ArrowDown" || event.key.toLowerCase() === "j"
          ? 1
          : event.key === "ArrowUp" || event.key.toLowerCase() === "k"
            ? -1
            : 0;
      if (!delta || cases.length === 0) return;
      event.preventDefault();
      const currentIndex = Math.max(
        0,
        cases.findIndex((item) => item.id === selectedId),
      );
      const next = cases[Math.min(cases.length - 1, Math.max(0, currentIndex + delta))];
      if (next) selectCase(next.id, true);
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [cases, loadQueue, selectCase, selectedId]);

  const compatibleReasons = useMemo(
    () => detail?.reasonOptions.filter((option) => option.actions.includes(action)) ?? [],
    [action, detail],
  );

  function changeAction(nextAction: ModerationAction): void {
    setAction(nextAction);
    const nextReason = detail?.reasonOptions.find((option) =>
      option.actions.includes(nextAction),
    )?.code;
    if (nextReason) setReasonCode(nextReason);
    setFeedback(null);
  }

  async function commitAction(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail || !selectedId || !canAct) return;
    setSubmitting(true);
    setFeedback(null);
    const payload: ModerationActionRequest = {
      action,
      reasonCode,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const fingerprint = JSON.stringify({
      caseId: selectedId,
      version: detail.case.version,
      payload,
    });
    if (actionAttempt.current?.fingerprint !== fingerprint) {
      actionAttempt.current = {
        fingerprint,
        key: `admin-mod-${crypto.randomUUID()}`,
      };
    }
    try {
      const response = await fetch(`/v1/admin/moderation/cases/${selectedId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": actionAttempt.current.key,
          "if-match": `"moderation-case-v${detail.case.version}"`,
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 409) {
        setFeedback("conflict");
        await loadQueue(selectedId);
        return;
      }
      if (!response.ok) throw new Error("action");
      void ((await response.json()) as ModerationActionResponse);
      actionAttempt.current = null;
      setNote("");
      setFeedback("success");
      await loadQueue();
    } catch {
      setFeedback("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="moderationWorkspace" aria-labelledby="moderation-workspace-title">
      <header className="workspaceHeader">
        <div>
          <h2 id="moderation-workspace-title">{text.title}</h2>
          <p>{text.intro}</p>
        </div>
        <button type="button" onClick={() => void loadQueue(selectedId ?? undefined)}>
          {text.refresh}
        </button>
      </header>
      <p className="keyboardHelp">{text.keyboard}</p>
      {generatedAt ? (
        <p className="freshness">
          {text.generated}: <time dateTime={generatedAt}>{displayTime(generatedAt, locale)}</time>
        </p>
      ) : null}
      {loading ? <p role="status">{text.loading}</p> : null}
      {loadError ? <p role="alert">{text.error}</p> : null}
      {!loading && !loadError && cases.length === 0 ? <p>{text.empty}</p> : null}
      {cases.length > 0 ? (
        <div className="moderationLayout">
          <section className="caseQueue" aria-labelledby="case-queue-title">
            <h3 id="case-queue-title">{text.queue}</h3>
            <ol>
              {cases.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === selectedId ? "selected" : undefined}
                    aria-current={item.id === selectedId ? "true" : undefined}
                    aria-keyshortcuts="J K ArrowDown ArrowUp"
                    ref={(element) => {
                      if (element) caseButtons.current.set(item.id, element);
                      else caseButtons.current.delete(item.id);
                    }}
                    onClick={() => selectCase(item.id)}
                  >
                    <strong>{item.listing.title}</strong>
                    <span>
                      {item.riskTier} · {text.priority} {item.priority}
                    </span>
                    <span>
                      {text.due}: {displayTime(item.slaDueAt, locale)}
                      {item.isSlaBreached ? ` · ${text.breached}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          {detail ? (
            <article className="caseDetail">
              <section aria-labelledby="snapshot-title">
                <div className="sectionHeading">
                  <h3 id="snapshot-title">{text.detail}</h3>
                  <span>{detail.snapshot.sensitiveFieldsRedacted ? text.redacted : null}</span>
                </div>
                <dl className="snapshotGrid">
                  <div>
                    <dt>Title</dt>
                    <dd>{detail.snapshot.title}</dd>
                  </div>
                  <div>
                    <dt>Type / locale</dt>
                    <dd>
                      {detail.snapshot.type} · {detail.snapshot.locale}
                    </dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>
                      {locale === "zh-Hans"
                        ? detail.snapshot.category.nameZhHans
                        : detail.snapshot.category.nameEn}
                    </dd>
                  </div>
                  <div>
                    <dt>Region</dt>
                    <dd>
                      {locale === "zh-Hans"
                        ? detail.snapshot.region.nameZhHans
                        : detail.snapshot.region.nameEn}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>Summary</dt>
                    <dd>{detail.snapshot.summary ?? "—"}</dd>
                  </div>
                  <div className="wide">
                    <dt>Body</dt>
                    <dd className="contentBody">{detail.snapshot.body}</dd>
                  </div>
                  <div className="wide">
                    <dt>Attributes</dt>
                    <dd>
                      <pre>{displayValue(detail.snapshot.attributes)}</pre>
                    </dd>
                  </div>
                </dl>
              </section>
              <section aria-labelledby="diff-title">
                <h3 id="diff-title">{text.diff}</h3>
                <p>{text.firstSubmission}</p>
                <ul className="diffList">
                  {detail.diff.map((entry) => (
                    <li key={entry.field}>
                      <strong>{entry.field}</strong>
                      <span>{entry.kind}</span>
                      <pre>{displayValue(entry.after)}</pre>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="evidenceGrid">
                <section aria-labelledby="rules-title">
                  <h3 id="rules-title">{text.rules}</h3>
                  {detail.rules.length === 0 ? <p>{text.noRules}</p> : null}
                  <ul>
                    {detail.rules.map((rule) => (
                      <li key={rule.ruleCode}>
                        <strong>{rule.ruleCode}</strong>
                        <span>
                          v{rule.ruleVersion} · {rule.severity} · {rule.evidenceKey}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section aria-labelledby="publisher-title">
                  <h3 id="publisher-title">{text.publisher}</h3>
                  <dl>
                    <div>
                      <dt>{text.accountAge}</dt>
                      <dd>{detail.publisherHistory.accountAgeDays}</dd>
                    </div>
                    <div>
                      <dt>{text.submitted}</dt>
                      <dd>{detail.publisherHistory.submittedCount}</dd>
                    </div>
                    <div>
                      <dt>{text.published}</dt>
                      <dd>{detail.publisherHistory.publishedCount}</dd>
                    </div>
                    <div>
                      <dt>{text.rejected}</dt>
                      <dd>{detail.publisherHistory.rejectedCount}</dd>
                    </div>
                    <div>
                      <dt>{text.suspended}</dt>
                      <dd>{detail.publisherHistory.suspendedCount}</dd>
                    </div>
                  </dl>
                </section>
                <section aria-labelledby="media-title">
                  <h3 id="media-title">{text.media}</h3>
                  {detail.media.length === 0 ? <p>{text.noMedia}</p> : null}
                  <ul>
                    {detail.media.map((media) => (
                      <li key={media.mediaId}>
                        <code>{media.mediaId.slice(0, 8)}</code>
                        <span>
                          {media.status}
                          {media.rejectionCode ? ` · ${media.rejectionCode}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <section className="actionPanel" aria-labelledby="action-title">
                <h3 id="action-title">{text.actionTitle}</h3>
                {!canAct ? <p role="status">{text.stepUp}</p> : null}
                {detail.availableActions.length > 0 ? (
                  <form onSubmit={(event) => void commitAction(event)}>
                    <label>
                      <span>{text.action}</span>
                      <select
                        ref={actionSelect}
                        value={action}
                        disabled={!canAct || submitting}
                        aria-keyshortcuts="Alt+A"
                        onChange={(event) => changeAction(event.target.value as ModerationAction)}
                      >
                        {detail.availableActions.map((option) => (
                          <option key={option} value={option}>
                            {text.actions[option]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{text.reason}</span>
                      <select
                        value={reasonCode}
                        disabled={!canAct || submitting}
                        onChange={(event) => setReasonCode(event.target.value as ReasonCode)}
                      >
                        {compatibleReasons.map((option) => (
                          <option key={option.code} value={option.code}>
                            {text.reasons[option.code]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{text.note}</span>
                      <textarea
                        maxLength={500}
                        value={note}
                        disabled={!canAct || submitting}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={!canAct || submitting}>
                      {text.submit}
                    </button>
                  </form>
                ) : null}
                {feedback ? (
                  <p role={feedback === "success" ? "status" : "alert"}>
                    {feedback === "success"
                      ? text.actionSuccess
                      : feedback === "conflict"
                        ? text.actionConflict
                        : text.actionError}
                  </p>
                ) : null}
              </section>
              <footer>
                {text.source}: {detail.source} · {displayTime(detail.generatedAt, locale)}
              </footer>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

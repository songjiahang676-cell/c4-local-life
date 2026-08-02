"use client";

import type {
  AdminJob,
  AdminJobResponse,
  QueueDeadLetter,
  QueueDeadLetterCollection,
} from "@socal/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Locale = "zh-Hans" | "en-US";
type QueueFilters = {
  source: "" | "OUTBOX" | "QUEUE";
  eventType: string;
  failureCode: string;
};
type EvidenceState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      items: readonly QueueDeadLetter[];
      nextCursor: string | null;
      generatedAt: string;
    };

const copy = {
  "zh-Hans": {
    title: "队列恢复与对账",
    intro:
      "仅显示最小化失败证据。PostgreSQL 是事实源；重放和对账均通过受控、可审计的异步批次执行。",
    refresh: "刷新失败列表",
    loading: "正在读取失败证据…",
    error: "队列状态暂时不可用，请稍后重试。",
    empty: "当前筛选条件下没有未解决的失败记录。",
    filters: "筛选",
    source: "来源",
    all: "全部",
    eventType: "事件类型",
    failureCode: "失败代码",
    apply: "应用筛选",
    select: "选择",
    eventId: "事件 ID",
    attempts: "尝试次数",
    failedAt: "最近失败",
    status: "状态",
    loadMore: "加载更多",
    replayTitle: "受控重放批次",
    selected: (count: number) => `已选择 ${count} 条`,
    reason: "标准原因代码",
    ticket: "工单编号（可选）",
    confirmReplay: "我已确认目标、失败原因和当前代码版本，允许重放所选事件。",
    replay: "创建重放批次",
    reconcileTitle: "队列对账",
    dryRun: "仅预览，不修复",
    maxItems: "最大检查数量",
    confirmRepair: "我已确认本次对账可以修复派生的 DLQ 证据。",
    reconcile: "创建对账任务",
    stepUp: "写操作需要十分钟内完成的 MFA 再验证。",
    mutationError: "任务未创建，请检查权限、目标状态或幂等键后重试。",
    jobTitle: "最近任务",
    jobType: "类型",
    progress: "进度",
    outcome: "结果",
    created: "已创建任务，Worker 将异步处理。",
    generated: "证据生成时间",
  },
  "en-US": {
    title: "Queue recovery & reconciliation",
    intro:
      "Only minimized failure evidence is shown. PostgreSQL remains canonical; replay and reconciliation run as controlled, audited asynchronous batches.",
    refresh: "Refresh failures",
    loading: "Loading failure evidence…",
    error: "Queue evidence is temporarily unavailable. Try again later.",
    empty: "No unresolved failure matches the current filters.",
    filters: "Filters",
    source: "Source",
    all: "All",
    eventType: "Event type",
    failureCode: "Failure code",
    apply: "Apply filters",
    select: "Select",
    eventId: "Event ID",
    attempts: "Attempts",
    failedAt: "Last failed",
    status: "Status",
    loadMore: "Load more",
    replayTitle: "Controlled replay batch",
    selected: (count: number) => `${count} selected`,
    reason: "Stable reason code",
    ticket: "Incident ticket (optional)",
    confirmReplay: "I verified the targets, failure reason, and current code version for replay.",
    replay: "Create replay batch",
    reconcileTitle: "Queue reconciliation",
    dryRun: "Preview only; do not repair",
    maxItems: "Maximum records",
    confirmRepair: "I verified this run may repair derived DLQ evidence.",
    reconcile: "Create reconciliation job",
    stepUp: "Writes require MFA verified within the last ten minutes.",
    mutationError: "The job was not created. Check authorization, target state, or retry key.",
    jobTitle: "Latest job",
    jobType: "Type",
    progress: "Progress",
    outcome: "Outcome",
    created: "Job created; the Worker will process it asynchronously.",
    generated: "Evidence generated",
  },
} as const;

function operationKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function selectionKey(item: Pick<QueueDeadLetter, "id" | "source">): string {
  return `${item.source}:${item.id}`;
}

export function QueueOperationsWorkspace({ locale, canAct }: { locale: Locale; canAct: boolean }) {
  const text = copy[locale];
  const [state, setState] = useState<EvidenceState>({ kind: "loading" });
  const [source, setSource] = useState<"" | "OUTBOX" | "QUEUE">("");
  const [eventType, setEventType] = useState("");
  const [failureCode, setFailureCode] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<QueueFilters>({
    source: "",
    eventType: "",
    failureCode: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonCode, setReasonCode] = useState("INCIDENT_RECOVERY");
  const [ticketRef, setTicketRef] = useState("");
  const [replayConfirmed, setReplayConfirmed] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [maxItems, setMaxItems] = useState(100);
  const [reconciliationReason, setReconciliationReason] = useState("DRIFT_CHECK");
  const [repairConfirmed, setRepairConfirmed] = useState(false);
  const [job, setJob] = useState<AdminJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const operationAttempts = useRef(
    new Map<string, { bodyFingerprint: string; idempotencyKey: string }>(),
  );

  const load = useCallback(
    async (cursor?: string, append = false): Promise<void> => {
      if (!append) setState({ kind: "loading" });
      const query = new URLSearchParams({ limit: "20" });
      if (appliedFilters.source) query.set("source", appliedFilters.source);
      if (appliedFilters.eventType) query.set("eventType", appliedFilters.eventType);
      if (appliedFilters.failureCode) query.set("failureCode", appliedFilters.failureCode);
      if (cursor) query.set("cursor", cursor);
      try {
        const response = await fetch(`/v1/admin/system/queue/dead-letters?${query}`, {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("queue unavailable");
        const payload = (await response.json()) as QueueDeadLetterCollection;
        setState((current) => ({
          kind: "ready",
          items:
            append && current.kind === "ready" ? [...current.items, ...payload.data] : payload.data,
          nextCursor: payload.page.nextCursor ?? null,
          generatedAt: payload.generatedAt,
        }));
      } catch {
        setState({ kind: "error" });
      }
    },
    [appliedFilters],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!job || !["PENDING", "RUNNING"].includes(job.status)) return;
    const timer = window.setTimeout(() => {
      void fetch(`/v1/admin/system/jobs/${job.id}`, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("job"))))
        .then((payload: AdminJobResponse) => setJob(payload.data))
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [job]);

  const selectedTargets = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.items
      .filter((item) => item.status === "OPEN" && selected.has(selectionKey(item)))
      .map((item) => ({ source: item.source, targetId: item.id }));
  }, [selected, state]);

  async function postJob(path: string, body: unknown, prefix: string): Promise<void> {
    const bodyFingerprint = JSON.stringify(body);
    const priorAttempt = operationAttempts.current.get(prefix);
    const idempotencyKey =
      priorAttempt?.bodyFingerprint === bodyFingerprint
        ? priorAttempt.idempotencyKey
        : operationKey(prefix);
    operationAttempts.current.set(prefix, { bodyFingerprint, idempotencyKey });
    setSubmitting(true);
    setMutationError(false);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("job rejected");
      setJob(((await response.json()) as AdminJobResponse).data);
      operationAttempts.current.delete(prefix);
    } catch {
      setMutationError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function createReplay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canAct || !replayConfirmed || selectedTargets.length === 0) return;
    await postJob(
      "/v1/admin/system/queue/replay-batches",
      {
        targets: selectedTargets,
        reasonCode: reasonCode.trim().toUpperCase(),
        ...(ticketRef.trim() ? { ticketRef: ticketRef.trim() } : {}),
      },
      "admin-queue-replay",
    );
    setReplayConfirmed(false);
  }

  async function createReconciliation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canAct || (!dryRun && !repairConfirmed)) return;
    await postJob(
      "/v1/admin/system/queue/reconciliation-runs",
      {
        dryRun,
        maxItems,
        reasonCode: reconciliationReason.trim().toUpperCase(),
        ...(ticketRef.trim() ? { ticketRef: ticketRef.trim() } : {}),
      },
      "admin-queue-reconcile",
    );
    setRepairConfirmed(false);
  }

  return (
    <section className="queueOperationsWorkspace" aria-labelledby="queue-operations-title">
      <header className="workspaceHeader">
        <div>
          <h2 id="queue-operations-title">{text.title}</h2>
          <p>{text.intro}</p>
        </div>
        <button type="button" onClick={() => void load()}>
          {text.refresh}
        </button>
      </header>

      <form
        className="queueFilters panel"
        aria-label={text.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const nextFilters: QueueFilters = {
            source,
            eventType: eventType.trim(),
            failureCode: failureCode.trim().toUpperCase(),
          };
          setSelected(new Set());
          if (
            nextFilters.source === appliedFilters.source &&
            nextFilters.eventType === appliedFilters.eventType &&
            nextFilters.failureCode === appliedFilters.failureCode
          ) {
            void load();
          } else {
            setAppliedFilters(nextFilters);
          }
        }}
      >
        <label>
          <span>{text.source}</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="">{text.all}</option>
            <option value="OUTBOX">OUTBOX</option>
            <option value="QUEUE">QUEUE</option>
          </select>
        </label>
        <label>
          <span>{text.eventType}</span>
          <input
            value={eventType}
            maxLength={120}
            pattern="[a-z][a-z0-9.-]{0,119}"
            onChange={(event) => setEventType(event.target.value)}
          />
        </label>
        <label>
          <span>{text.failureCode}</span>
          <input
            value={failureCode}
            maxLength={120}
            pattern="[A-Za-z][A-Za-z0-9_.-]{1,119}"
            onChange={(event) => setFailureCode(event.target.value)}
          />
        </label>
        <button type="submit">{text.apply}</button>
      </form>

      {state.kind === "loading" ? <p role="status">{text.loading}</p> : null}
      {state.kind === "error" ? <p role="alert">{text.error}</p> : null}
      {state.kind === "ready" ? (
        <section className="queueEvidence panel" aria-live="polite">
          {state.items.length === 0 ? (
            <p>{text.empty}</p>
          ) : (
            <div className="queueTableScroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{text.select}</th>
                    <th scope="col">{text.source}</th>
                    <th scope="col">{text.eventType}</th>
                    <th scope="col">{text.eventId}</th>
                    <th scope="col">{text.attempts}</th>
                    <th scope="col">{text.failureCode}</th>
                    <th scope="col">{text.status}</th>
                    <th scope="col">{text.failedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((item) => (
                    <tr key={`${item.source}:${item.id}`}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${text.select} ${item.eventType} ${item.eventId}`}
                          checked={selected.has(selectionKey(item))}
                          disabled={item.status !== "OPEN"}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              const key = selectionKey(item);
                              if (event.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td>{item.source}</td>
                      <td>{item.eventType}</td>
                      <td>
                        <code>{item.eventId}</code>
                      </td>
                      <td>{item.attemptCount}</td>
                      <td>
                        <code>{item.failureCode}</code>
                      </td>
                      <td>{item.status}</td>
                      <td>{new Date(item.failedAt).toLocaleString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <footer>
            <span>
              {text.generated}: {new Date(state.generatedAt).toLocaleString(locale)}
            </span>
            {state.nextCursor ? (
              <button type="button" onClick={() => void load(state.nextCursor!, true)}>
                {text.loadMore}
              </button>
            ) : null}
          </footer>
        </section>
      ) : null}

      {!canAct ? <p className="stepUpWarning">{text.stepUp}</p> : null}
      <div className="queueOperationForms">
        <form className="panel" onSubmit={(event) => void createReplay(event)}>
          <h3>{text.replayTitle}</h3>
          <p>{text.selected(selectedTargets.length)}</p>
          <label>
            <span>{text.reason}</span>
            <input
              required
              maxLength={80}
              pattern="[A-Z][A-Z0-9_.-]{1,79}"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>{text.ticket}</span>
            <input
              maxLength={120}
              pattern="[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}"
              value={ticketRef}
              onChange={(event) => setTicketRef(event.target.value)}
            />
          </label>
          <label className="confirmationCheck">
            <input
              type="checkbox"
              checked={replayConfirmed}
              onChange={(event) => setReplayConfirmed(event.target.checked)}
            />
            <span>{text.confirmReplay}</span>
          </label>
          <button
            type="submit"
            disabled={!canAct || submitting || !replayConfirmed || selectedTargets.length === 0}
          >
            {text.replay}
          </button>
        </form>

        <form className="panel" onSubmit={(event) => void createReconciliation(event)}>
          <h3>{text.reconcileTitle}</h3>
          <label className="confirmationCheck">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => setDryRun(event.target.checked)}
            />
            <span>{text.dryRun}</span>
          </label>
          <label>
            <span>{text.maxItems}</span>
            <input
              type="number"
              min={1}
              max={500}
              required
              value={maxItems}
              onChange={(event) => setMaxItems(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{text.reason}</span>
            <input
              required
              maxLength={80}
              pattern="[A-Z][A-Z0-9_.-]{1,79}"
              value={reconciliationReason}
              onChange={(event) => setReconciliationReason(event.target.value.toUpperCase())}
            />
          </label>
          {!dryRun ? (
            <label className="confirmationCheck">
              <input
                type="checkbox"
                checked={repairConfirmed}
                onChange={(event) => setRepairConfirmed(event.target.checked)}
              />
              <span>{text.confirmRepair}</span>
            </label>
          ) : null}
          <button type="submit" disabled={!canAct || submitting || (!dryRun && !repairConfirmed)}>
            {text.reconcile}
          </button>
        </form>
      </div>

      {mutationError ? <p role="alert">{text.mutationError}</p> : null}
      {job ? (
        <section className="panel queueJobStatus" aria-live="polite">
          <h3>{text.jobTitle}</h3>
          <p>{text.created}</p>
          <dl>
            <div>
              <dt>{text.jobType}</dt>
              <dd>{job.type}</dd>
            </div>
            <div>
              <dt>{text.status}</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt>{text.progress}</dt>
              <dd>
                {job.processedItems} / {job.estimatedItems}
              </dd>
            </div>
            <div>
              <dt>{text.outcome}</dt>
              <dd>
                {job.succeededItems} / {job.skippedItems} / {job.failedItems}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </section>
  );
}

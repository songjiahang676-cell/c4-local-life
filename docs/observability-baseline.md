# OBS-001 可观测性实施基线

本基线实现 `docs/17-observability-analytics.md` 中的日志、RED 指标和 OpenTelemetry Trace 最小闭环。它不绑定特定可观测性供应商；生产环境通过 OTLP Collector 转发。

## 结构化日志

API 与 Worker 统一使用 `@socal/observability` 输出单行 JSON。每条记录固定包含：

- `timestamp`、`level`、`event`；
- `service`、`environment`、`version`；
- 当前上下文中的 `requestId`、`traceId`、`spanId`；
- Worker 任务日志额外包含 `jobId`、`jobName`、`durationMs` 和 `outcome`。

HTTP 日志只记录规范化 method、路由模板、状态码和耗时，不记录 query string、请求头或 body。Worker 只读取 `data.telemetry` 中的传播字段，不序列化任务 payload。

日志清洗器递归屏蔽 secret/password/OTP/token/authorization/cookie/credential/email/phone/address/message/body/content/payload/query 等敏感字段，并识别自由文本中的邮箱、北美电话号码和支付卡样式。错误只记录分类与内部错误码，不记录 provider 原始消息或 stack。

## Trace 传播

API 接收标准 W3C `traceparent`/`tracestate`，为每个请求建立 server span，并在响应中返回 `traceparent`。异步生产者应把当前传播字段写入下面的最小 envelope：

```json
{
  "telemetry": {
    "requestId": "accepted-or-generated-request-id",
    "traceparent": "00-<trace-id>-<span-id>-01",
    "tracestate": "optional-vendor-state"
  }
}
```

Worker 建立 consumer span 并继承上游 trace。无上游字段时会生成新的 request/trace id。OTLP 导出地址由 `OTEL_EXPORTER_OTLP_ENDPOINT` 配置；该值是 base endpoint，SDK 向其 `/v1/traces` 端点发送数据。未配置导出端点时仍生成本地 Trace 上下文，但不执行网络导出。

## 基础指标

API 的 `GET /metrics` 与 Worker 健康端口的 `GET /metrics` 以 Prometheus 文本格式提供：

- `socal_http_requests_in_flight`
- `socal_http_requests_total`
- `socal_http_request_duration_seconds`
- `socal_worker_jobs_in_flight`
- `socal_worker_jobs_total`
- `socal_worker_job_duration_seconds`
- `socal_outbox_dispatch_total`
- `socal_outbox_poll_failures_total`
- `socal_outbox_oldest_pending_age_seconds`
- `socal_media_processing_total`

HTTP label 只允许 method、路由模板、状态码分类；Worker label 只允许受限 job name 和 outcome。
Outbox 结果只允许 published/retry/failed/stale，不使用 event type、eventId 或 aggregate 作为 label。禁止把用户
ID、查询词、URL、资源 ID、邮箱、手机号、payload 或异常消息写入 label。`/metrics` 是运维端点，不属于
公共 OpenAPI；部署时必须在负载均衡器/安全组层仅允许 Collector 或受控运维网络访问。
媒体处理 outcome 只允许 ready/rejected/stale；对象 key、hash、MIME、扫描 signature 和 rejection code
都不能成为 label。

## 配置

| 变量                          | 默认值       | 说明                                 |
| ----------------------------- | ------------ | ------------------------------------ |
| `LOG_LEVEL`                   | `info`       | 最低 JSON 日志等级                   |
| `OTEL_SERVICE_NAME`           | 应用内回退值 | API/Worker 的 OTel service name      |
| `OTEL_SERVICE_VERSION`        | `0.1.0`      | 部署 artifact 版本                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 空           | OTLP base endpoint；空值关闭网络导出 |

Compose 分别把 API 与 Worker 标记为 `socal-api` 和 `socal-worker`。正式部署应把 service version 设置为不可变 artifact/commit 版本。

## 验证

```bash
pnpm --filter @socal/observability test
pnpm --filter @socal/api test
pnpm --filter @socal/worker test
pnpm typecheck
pnpm lint
```

测试覆盖 W3C 父 trace 继承、HTTP 响应 trace、Worker 跨任务传播、RED 指标和 PII/provider-error 不落日志。

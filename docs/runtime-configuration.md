# 运行时配置与秘密管理

本项目在进程启动时通过 `@socal/config` 校验环境变量。必需配置缺失或类型错误时，API 与 Worker 必须以非零状态退出，不得带着不完整配置继续运行。

## 环境文件

- `.env.example` 只包含本地开发占位值，可以提交。
- `.env` 仅供本机使用，已被 Git 忽略。
- CI 通过 workflow `env` 注入测试值。
- staging/production 的秘密必须来自 Secrets Manager、SSM Parameter Store 或等价的受控秘密服务，不得写入镜像、Terraform 明文变量、日志或仓库。

## 通用配置

| 变量                          | 必需 | 用途                                                                 |
| ----------------------------- | ---- | -------------------------------------------------------------------- |
| `NODE_ENV`                    | 是   | Node 运行模式：`development`、`test`、`production`                   |
| `APP_ENV`                     | 是   | 部署环境：`local`、`test`、`preview`、`dev`、`staging`、`production` |
| `APP_NAME`                    | 否   | 日志和遥测中的应用名称                                               |
| `LOG_LEVEL`                   | 否   | 结构日志等级                                                         |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 否   | OpenTelemetry 导出地址                                               |
| `OTEL_SERVICE_NAME`           | 否   | OpenTelemetry 服务名                                                 |
| `OTEL_SERVICE_VERSION`        | 否   | 不可变部署版本，默认 `0.1.0`                                         |

## API 配置

| 变量                             | 必需 | 敏感 | 用途                                          |
| -------------------------------- | ---- | ---- | --------------------------------------------- |
| `PORT`                           | 否   | 否   | API 监听端口，默认 4000                       |
| `API_BODY_LIMIT_BYTES`           | 否   | 否   | 通用 JSON body 上限，默认 1 MiB               |
| `PUBLIC_WEB_URL`                 | 是   | 否   | Web CORS 来源                                 |
| `PUBLIC_ADMIN_URL`               | 是   | 否   | Admin CORS 来源                               |
| `DATABASE_URL`                   | 是   | 是   | PostgreSQL 连接串                             |
| `DATABASE_POOL_MAX`              | 否   | 否   | 数据库连接池上限                              |
| `REDIS_URL`                      | 是   | 可能 | Redis/BullMQ 连接串                           |
| `OPENSEARCH_NODE`                | 是   | 否   | OpenSearch 地址                               |
| `OPENSEARCH_USERNAME`            | 否   | 是   | OpenSearch 用户名                             |
| `OPENSEARCH_PASSWORD`            | 否   | 是   | OpenSearch 密码                               |
| `S3_ENDPOINT`                    | 否   | 否   | 本地 MinIO/兼容存储地址；AWS 留空使用默认端点 |
| `S3_REGION`                      | 否   | 否   | 对象存储区域，默认 `us-west-2`                |
| `S3_QUARANTINE_BUCKET`           | 否   | 否   | 私有原始上传 bucket                           |
| `S3_ACCESS_KEY`                  | 否   | 是   | 本地静态 access key；生产优先任务角色         |
| `S3_SECRET_KEY`                  | 否   | 是   | 与 access key 成对提供                        |
| `S3_FORCE_PATH_STYLE`            | 否   | 否   | MinIO path-style 开关                         |
| `MEDIA_UPLOAD_URL_TTL_SECONDS`   | 否   | 否   | PUT URL 有效期，默认 300、最长 900 秒         |
| `MEDIA_UPLOAD_MAX_ACTIVE`        | 否   | 否   | 每用户未过期 intent 上限，默认 20             |
| `MEDIA_UPLOAD_DAILY_BYTES`       | 否   | 否   | 每用户滚动 24 小时声明字节配额，默认 200 MiB  |
| `SESSION_SECRET`                 | 是   | 是   | 会话 token HMAC 秘密，至少 32 字节            |
| `SESSION_COOKIE_NAME`            | 否   | 否   | 会话 Cookie 名称                              |
| `SESSION_ABSOLUTE_TTL_SECONDS`   | 否   | 否   | 会话绝对期限，默认 30 天、最长 365 天         |
| `SESSION_IDLE_TTL_SECONDS`       | 否   | 否   | 会话闲置期限，默认 7 天且不得超过绝对期限     |
| `SESSION_TOUCH_INTERVAL_SECONDS` | 否   | 否   | 刷新闲置期限的最小间隔，默认 5 分钟           |
| `CSRF_SECRET`                    | 是   | 是   | CSRF 防护秘密，至少 32 字节                   |
| `OTP_SECRET`                     | 是   | 是   | OTP、账号/IP/设备 HMAC 秘密，至少 32 字节     |
| `OTP_TTL_SECONDS`                | 否   | 否   | OTP 有效期，默认 10 分钟、最长 30 分钟        |
| `OTP_MAX_ATTEMPTS`               | 否   | 否   | 单个 challenge 最大失败次数，默认 5           |
| `OTP_DESTINATION_LIMIT`          | 否   | 否   | 同账号窗口请求上限，默认 3                    |
| `OTP_DESTINATION_WINDOW_SECONDS` | 否   | 否   | 同账号限频窗口，默认 15 分钟                  |
| `OTP_IP_LIMIT`                   | 否   | 否   | 同 IP 窗口请求上限，默认 20                   |
| `OTP_IP_WINDOW_SECONDS`          | 否   | 否   | 同 IP 限频窗口，默认 1 小时                   |
| `OTP_DEVICE_LIMIT`               | 否   | 否   | 同设备窗口请求上限，默认 10                   |
| `OTP_DEVICE_WINDOW_SECONDS`      | 否   | 否   | 同设备限频窗口，默认 1 小时                   |

功能开关 `FEATURE_PAYMENTS`、`FEATURE_MESSAGING`、`FEATURE_COMMUNITY`、`FEATURE_CROSS_BORDER` 只接受 `true` 或 `false`。

## Web / Admin 服务端配置

| 变量           | 必需 | 敏感 | 用途                                                          |
| -------------- | ---- | ---- | ------------------------------------------------------------- |
| `API_BASE_URL` | 是   | 否   | Next.js 服务端/BFF 访问 API 的内部 `/v1` 地址，不暴露给浏览器 |

Admin 的同源 BFF 只代理代码内 allowlist 的认证与 Admin Session 路径；`API_BASE_URL` 不能来自请求
参数，也不能指向非 HTTP(S) scheme。生产网络策略还应只允许 Admin workload 连接受信 API service。

## Worker 配置

| 变量                 | 必需 | 用途                              |
| -------------------- | ---- | --------------------------------- |
| `REDIS_URL`          | 是   | 队列连接                          |
| `WORKER_CONCURRENCY` | 否   | Worker 并发数，范围 1–100，默认 5 |
| `WORKER_HEALTH_PORT` | 否   | Worker 健康检查端口，默认 4001    |

## 安全规则

- `SecretValue` 的字符串化和 JSON 序列化固定输出 `[REDACTED]`；仅在供应商适配器的最窄边界调用 `reveal()`。
- `redactSensitiveValue` 对 token、password、cookie、authorization、credential 和 key 等字段递归脱敏。
- 启动失败日志只输出配置字段名与验证原因，不输出输入值。
- 不记录完整连接串、请求头、作业载荷、OTP、会话或支付信息。
- 生产秘密轮换必须支持新旧值短期并存、验证、切换和撤销，并在运行手册中留下审计记录。
- `S3_ACCESS_KEY`/`S3_SECRET_KEY` 必须同时存在或同时省略；生产省略时由工作负载身份提供短期凭据。
- quarantine bucket 禁止匿名访问和网站托管；签名 URL 不是日志字段，过期后须用新幂等键重新申请。

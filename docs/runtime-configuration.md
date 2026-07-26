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

| 变量                             | 必需 | 敏感 | 用途                                      |
| -------------------------------- | ---- | ---- | ----------------------------------------- |
| `PORT`                           | 否   | 否   | API 监听端口，默认 4000                   |
| `API_BODY_LIMIT_BYTES`           | 否   | 否   | 通用 JSON body 上限，默认 1 MiB           |
| `PUBLIC_WEB_URL`                 | 是   | 否   | Web CORS 来源                             |
| `PUBLIC_ADMIN_URL`               | 是   | 否   | Admin CORS 来源                           |
| `DATABASE_URL`                   | 是   | 是   | PostgreSQL 连接串                         |
| `DATABASE_POOL_MAX`              | 否   | 否   | 数据库连接池上限                          |
| `REDIS_URL`                      | 是   | 可能 | Redis/BullMQ 连接串                       |
| `OPENSEARCH_NODE`                | 是   | 否   | OpenSearch 地址                           |
| `OPENSEARCH_USERNAME`            | 否   | 是   | OpenSearch 用户名                         |
| `OPENSEARCH_PASSWORD`            | 否   | 是   | OpenSearch 密码                           |
| `SESSION_SECRET`                 | 是   | 是   | 会话 token HMAC 秘密，至少 32 字节        |
| `SESSION_COOKIE_NAME`            | 否   | 否   | 会话 Cookie 名称                          |
| `SESSION_ABSOLUTE_TTL_SECONDS`   | 否   | 否   | 会话绝对期限，默认 30 天、最长 365 天     |
| `SESSION_IDLE_TTL_SECONDS`       | 否   | 否   | 会话闲置期限，默认 7 天且不得超过绝对期限 |
| `SESSION_TOUCH_INTERVAL_SECONDS` | 否   | 否   | 刷新闲置期限的最小间隔，默认 5 分钟       |
| `CSRF_SECRET`                    | 是   | 是   | CSRF 防护秘密，至少 32 字节               |

功能开关 `FEATURE_PAYMENTS`、`FEATURE_MESSAGING`、`FEATURE_COMMUNITY`、`FEATURE_CROSS_BORDER` 只接受 `true` 或 `false`。

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

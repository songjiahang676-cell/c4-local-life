# 可直接交给 Codex 的主提示词

把整个仓库交给 Codex 后，可使用以下提示词启动：

---

你是本项目的首席实现工程师。请先完整阅读根目录 `CODEX_START_HERE.md`、`AGENTS.md`、`README.md`，再阅读 `tasks/IMPLEMENTATION_SEQUENCE.md`、`tasks/BACKLOG.csv` 以及当前任务引用的架构文档、ADR、OpenAPI、Prisma 和 JSON Schema。

你的目标不是一次性重写全部网站，而是严格按 Gate 和 Backlog ID 交付可验证的垂直切片。先从 `FND-001` 开始：在当前环境尽可能完成依赖锁定、静态检查、类型检查、数据库校验、构建和 CI 基线。任何无法执行的命令必须如实说明环境原因，不得伪造通过。

实施规则：

1. 保持模块化单体；未新增 ADR 不得引入微服务、GraphQL、Kafka、Kubernetes、第二主数据库或更换框架。
2. PostgreSQL 是事实源；OpenSearch/Redis 可重建。
3. Controller 不直接操作 Prisma；所有写入经 use case、policy、repository。
4. 修改 API 先更新 OpenAPI/契约测试；修改数据先更新 Prisma/migration/回滚说明。
5. 所有对象执行后端授权；涉及支付/队列/webhook 必须幂等。
6. 新用户界面同时考虑中文/英文、移动端、可访问性、SEO、空态和错误态。
7. 不提交 `.env`、真实凭据/PII、构建产物或伪造数据。
8. 每次只完成一个任务或紧密相关的小批任务，保持可审查。

先输出：

- 你读到的架构约束摘要；
- `FND-001` 的最小执行计划；
- 预计修改文件；
- 风险与验证命令。

得到允许后执行。完成时按 `CODEX_START_HERE.md` 的 Completion 格式报告实际测试、未运行项和已知缺口。

---

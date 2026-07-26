# 交付验证报告

> 验证日期：2026-07-21  
> 架构包版本：0.1.0  
> 结论：**架构、契约和参考代码的离线静态验证通过；依赖安装后的动态工程验证待 Codex 在联网环境完成。**

## 1. 已执行并通过

| 检查项                | 方法                                                                             | 结果 |
| --------------------- | -------------------------------------------------------------------------------- | ---- |
| 必需文件与目录        | `scripts/check-architecture.sh`                                                  | 通过 |
| JSON 语法             | Python 标准库解析全部 JSON                                                       | 通过 |
| JSON Schema 结构      | Draft 2020-12 meta-schema 检查                                                   | 通过 |
| YAML 语法与重复键     | PyYAML 严格 mapping loader                                                       | 通过 |
| OpenAPI 版本/规模     | 3.1.x；31 paths；52 schemas                                                      | 通过 |
| OpenAPI 内部 `$ref`   | 遍历并解析 167 个引用                                                            | 通过 |
| OpenAPI 路径参数      | 占位符、声明与 `required=true` 一致                                              | 通过 |
| OpenAPI `operationId` | 唯一性检查                                                                       | 通过 |
| Backlog               | 100 个任务；ID 唯一；依赖存在且无环                                              | 通过 |
| Markdown 内部链接     | 相对链接目标存在                                                                 | 通过 |
| Prisma 静态结构       | 36 models；block/field/enum 名称无重复                                           | 通过 |
| 首个数据库迁移安全性  | `0000_extensions` 仅安装扩展，不提前访问业务表                                   | 通过 |
| TypeScript 语法解析   | 使用环境内 TypeScript 5.8.3 对 26 个非声明 `.ts/.tsx` 文件做 transpile-only 解析 | 通过 |
| 图片资产              | 首页设想图可读取，1672×941 RGBA；两处副本一致                                    | 通过 |
| 秘钥/私钥特征         | 扫描常见 AWS key/private-key 特征，确认未打包 `.env`                             | 通过 |
| 软链接与依赖目录      | 无 symlink、`node_modules`、`.next`、构建输出                                    | 通过 |

复跑命令：

```bash
bash scripts/check-architecture.sh
```

## 2. 未执行，不能标记为通过

当前容器无法访问 npm registry，且没有项目要求的 Node 24/pnpm 11 依赖环境，因此以下命令未完成：

```bash
corepack enable
pnpm install
pnpm db:validate
pnpm db:generate
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

同样尚未执行：

- `prisma migrate dev` 对空库的真实迁移；
- PostgreSQL/PostGIS 约束负例、查询计划和恢复测试；
- Docker 镜像拉取与 Compose 健康检查；
- OpenSearch analyzer/index mapping 真实验证；
- Terraform provider 初始化与真实 AWS `plan`；
- Playwright、可访问性、负载、安全和灾备演练。

这些项目已经作为 `FND-001`、`DATA-001` 及后续 Gate 任务写入 `tasks/BACKLOG.csv`，CI 也会要求先生成并提交 `pnpm-lock.yaml`。

## 3. 数据库迁移特别说明

`packages/database/prisma/migrations/0000_extensions/migration.sql` 可在表创建前安全执行，只安装 `pg_trgm` 与 `postgis`。

`packages/database/prisma/sql/post_schema_constraints.sql` **不是独立的前置迁移**。在 `DATA-001` 中应先执行 `prisma migrate dev --create-only` 生成首个建表迁移，再将该 SQL 按依赖顺序合并到相关 `CREATE TABLE` 之后，并在空库验证。

## 4. Codex 首轮验收标准

Codex 完成 `FND-001` 前不得进入业务功能开发。至少应提供：

1. `pnpm-lock.yaml`；
2. 以上动态命令的真实日志；
3. Prisma 首个基线迁移及回滚/roll-forward 说明；
4. Web、Admin、API、Worker 的基础构建结果；
5. CI 绿色证据；
6. 对任何版本/API 不兼容修复的变更记录。

# Repository 集成测试框架

`DATA-006` 在 `packages/database/src/testing/integration-database.ts` 提供真实 PostgreSQL Repository 测试隔离。它不模拟 Prisma/PostGIS，也不复用生产数据。

## 安全边界

- 必须显式设置 `DATABASE_INTEGRATION_URL`；专用命令缺失变量时直接失败，不会把 skip 当作通过。
- 默认只允许 `localhost`、`127.0.0.1`、`::1`。
- 数据库名必须包含 `test`、`baseline`、`integration` 或 `empty`，避免误指向普通业务库。
- 远程临时测试库还需显式设置 `ALLOW_REMOTE_INTEGRATION_DB=true`；数据库名称限制仍然生效。
- 日志和测试报告不得输出连接串。

## 事务隔离

每个测试用 `withRollback` 包住 Arrange/Act/Assert：

```ts
const database = createIntegrationDatabase(process.env.DATABASE_INTEGRATION_URL);

await database.withRollback(async (transaction) => {
  await transaction.user.create({ data: buildTestUser() });
  // repository 使用同一个 transaction；测试结束后统一回滚。
});

await database.close();
```

成功回调通过内部 sentinel 强制回滚；业务断言抛错时 Prisma 也回滚并把原始测试错误继续抛出。框架测试会分别验证两条路径结束后均无残留行。禁止在回调内使用全局 `prisma` 或另建连接，否则会绕开隔离边界。

扩展/迁移在 suite 启动前由 CI 执行一次，测试事务只创建虚构 fixture。稳定 UUID 只用于声明式 seed；普通测试 factory 默认随机 UUID，允许测试并行运行。

## 命令

```bash
# 指向已迁移的专用数据库
DATABASE_INTEGRATION_URL=postgresql://.../socal_test pnpm db:test:integration
```

Windows PowerShell：

```powershell
$env:DATABASE_INTEGRATION_URL = "postgresql://.../socal_test"
pnpm.cmd db:test:integration
```

普通 `pnpm test` 在未配置数据库时会把 `*.integration.test.ts` 标为 skipped，便于离线单元开发；CI 始终注入 URL，因此这些测试在质量门中必须真实执行。Gate/PR 验收以 CI 或显式 `db:test:integration` 的非 skip 结果为准。

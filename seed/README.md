# Seed Data

此目录只包含开发/演示种子，不是生产事实：

- `regions.socal.json`：南加州地区示例。
- `categories.zh-Hans.json`：五类 Listing 分类初稿。
- `homepage.zh-Hans.json`：首页模块配置示例。
- `sample-listings.json`：明显虚构的展示数据。

`DATA-003` 已提供：

- `pnpm db:seed:validate`：离线校验四个 JSON 文件的版本、字段、枚举、边界和明确的 synthetic disclaimer；
- `pnpm db:seed`：在一个事务中 upsert 稳定 UUID 的地区、分类、一个 `example.invalid` 用户和五条带 `[示例]` 前缀的草稿；
- `packages/database/src/testing/factories.ts`：生成隔离、虚构的 repository 测试输入；
- 真实 PostgreSQL 集成测试：同一 seed 连续执行两次，行数和稳定 ID 不变。

`db:seed` 只允许 `APP_ENV=local|test|dev|preview`，在 staging/production 会直接失败。样例 Listing 固定为 `DRAFT`/`NOT_REVIEWED`，不会伪装成已发布内容，也没有评价、广告或模拟热度。

地区中心点仍是开发占位值，不是权威 GIS 边界。生产导入遵循 `docs/29-migration-and-launch.md`，必须保留来源、授权、批次、去重和对账证据；不得把本目录的样例数字或文字当成真实生产数据。

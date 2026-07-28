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

`TAX-001` 在同一版本化文件中为首发地区和五个垂直分类根节点提供受控别名。当前开发种子导入
17 个地区、21 个地区别名、58 个分类和 15 个分类别名；别名使用稳定 UUID、locale 和 NFKC
归一化键幂等写入独立 FK 表。种子只协调其自身稳定 taxonomy ID 下的别名，不把名称重复成 Region，
也不代表生产 GIS、SEO 或运营批准范围。

`TAX-002` 为五个 Listing 垂直提供首版受控字段模板，子分类继承对应垂直模板；社区分类使用空字段
定义。`db:seed` 为全部 58 个分类建立不可变的已发布 form schema version 1，并物化 93 个当前字段。
五条 synthetic Listing 均固定记录 version 1，attributes 使用模板内的 option value。重复 seed 只
核对已发布内容哈希，不会修改历史；若模板需要变化，必须通过应用生命周期发布 version 2，而不是改写
version 1。

`db:seed` 只允许 `APP_ENV=local|test|dev|preview`，在 staging/production 会直接失败。样例 Listing 固定为 `DRAFT`/`NOT_REVIEWED`，不会伪装成已发布内容，也没有评价、广告或模拟热度。

地区中心点仍是开发占位值，不是权威 GIS 边界。生产导入遵循 `docs/29-migration-and-launch.md`，必须保留来源、授权、批次、去重和对账证据；不得把本目录的样例数字或文字当成真实生产数据。

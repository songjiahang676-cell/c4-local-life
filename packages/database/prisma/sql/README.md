# Prisma 手写 SQL 片段

`migrations/0000_extensions/migration.sql` 只负责在任何业务表创建前安装 `pg_trgm` 与 `postgis`，因此可安全作为首个迁移执行。

`post_schema_constraints.sql` 是首个基线迁移的后置片段，包含 Prisma Schema 无法完整表达或需要显式审核的能力：

- PostGIS `geography(Point, 4326)` 生成列和 GiST 索引；
- 标题 trigram 索引；
- 公开 Listing 部分索引；
- Review 评分范围约束；
- Order 必须属于用户或组织的约束。

在 `DATA-001` 中先运行 `prisma migrate dev --create-only` 生成建表 SQL，再把本片段按依赖顺序合并到该迁移并审查。不要把它作为表创建前的独立迁移执行。随后用空库迁移、重复迁移检查、约束负例和 `EXPLAIN` 证据验证。

`DATA-002` 在 `src/repositories/listing-geo.repository.ts` 封装 PostGIS 半径查询。Repository 对经纬度、半径、类型和条数做边界校验，所有值通过 Prisma SQL 参数绑定；公开投影只包含已审核、已发布、未删除、未过期且地区/分类有效的数据，不返回坐标。`test/listing-geo.repository.integration.test.ts` 使用真实 PostgreSQL/PostGIS 验证扩展幂等、trigram 可用、半径过滤和生成 geography 随坐标更新。

# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G0 Foundation
- 目标：可重复安装、校验、构建、测试和部署基础
- 进度：12/17 个 G0 任务完成；其余 5 个由 FND-003 合并保护依赖链阻塞
- 风险：GitHub Free 不为个人私有仓库提供 ruleset/branch protection；API 返回 HTTP 403

## 正在进行

| Task    | Owner                | Started    | Target                        | Status  | Notes                                       |
| ------- | -------------------- | ---------- | ----------------------------- | ------- | ------------------------------------------- |
| FND-003 | @songjiahang676-cell | 2026-07-25 | GitHub ruleset/branch protect | blocked | 需升级 GitHub Pro 或经负责人同意改为 public |

## Gate Evidence

| Evidence                         | Link/Artifact                             | Result                                               | Date       |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------- | ---------- |
| Static architecture check        | `scripts/check-architecture.sh`           | passed：101 tasks、31 paths、52 schemas、36 models   | 2026-07-25 |
| Hosted quality gate              | GitHub Actions run `30186103447`          | passed：locked install、51 tests、7 builds、E2E      | 2026-07-25 |
| Four image build/runtime health  | GitHub Actions job `89751350551`          | passed：4 images、`node` user、4 readiness endpoints | 2026-07-25 |
| Local complete quality           | `pnpm ci:quality`                         | passed：real PostgreSQL integration included         | 2026-07-25 |
| Failed clean-checkout evidence   | Runs `30185510707` / `30185679624`        | failures diagnosed and fixed                         | 2026-07-25 |
| Private-repository merge protect | GitHub branch protection and ruleset APIs | blocked：HTTP 403 requires Pro or public repository  | 2026-07-25 |

## Decisions / Blocks

- ADR-0006：正式公开上线后 12 个月全站免费；收费与自动充值延后到 Gate 5，默认关闭。
- 不会为绕过套餐限制擅自把私有仓库公开；FND-003 及其依赖项继续保持 `todo`。
- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

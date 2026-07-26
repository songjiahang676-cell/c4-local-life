# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G1 Identity / Taxonomy / Media
- 目标：安全身份上下文、主数据、动态表单和隔离上传
- 进度：1/13 个 G1 任务、18/101 个总任务完成
- 风险：AUTH-001 本地验收已通过，仍需受保护 PR 的托管质量/容器检查

## 正在进行

| Task     | Owner                | Started    | Target            | Status     | Notes                                          |
| -------- | -------------------- | ---------- | ----------------- | ---------- | ---------------------------------------------- |
| AUTH-001 | @songjiahang676-cell | 2026-07-25 | protected task PR | validating | 本地合同/迁移/66 tests/build 通过；等待托管 CI |

## Gate Evidence

| Evidence                        | Link/Artifact                      | Result                                               | Date       |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------- | ---------- |
| Static architecture check       | `scripts/check-architecture.sh`    | passed：101 tasks、31 paths、52 schemas、36 models   | 2026-07-25 |
| Hosted quality gate             | GitHub Actions run `30186103447`   | passed：locked install、51 tests、7 builds、E2E      | 2026-07-25 |
| Four image build/runtime health | GitHub Actions job `89751350551`   | passed：4 images、`node` user、4 readiness endpoints | 2026-07-25 |
| Local complete quality          | `pnpm ci:quality`                  | passed：real PostgreSQL integration included         | 2026-07-25 |
| Failed clean-checkout evidence  | Runs `30185510707` / `30185679624` | failures diagnosed and fixed                         | 2026-07-25 |
| Protected green PR              | PR #1 / run `30186346943`          | both required checks passed；merge state clean       | 2026-07-25 |
| Protected failing PR            | closed PR #2 / run `30187032798`   | required quality check failed；merge state blocked   | 2026-07-25 |
| `main` branch protection        | GitHub branch protection API       | PR + strict checks + conversations；admin enforced   | 2026-07-25 |
| Gate 0 protected merge          | PR #1 / run `30187153269`          | merged；final head quality + four-image smoke passed | 2026-07-25 |
| AUTH-001 local quality          | `pnpm ci:quality`                  | passed：22 files / 66 tests / 8 builds               | 2026-07-25 |
| AUTH-001 database lifecycle     | empty deploy + upgrade + baseline  | passed：4 migrations、hash/rotation/expiry/logout    | 2026-07-25 |

## Decisions / Blocks

- ADR-0006：正式公开上线后 12 个月全站免费；收费与自动充值延后到 Gate 5，默认关闭。
- 项目负责人于 2026-07-25 明确授权公开仓库；公开后立即启用 `main` 强制保护。
- Gate 0 已由受保护 PR #1 合并；Gate 1 从 AUTH-001 开始且未提前实现 OTP。
- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

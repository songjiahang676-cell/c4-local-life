# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G1 Identity / Taxonomy / Media
- 目标：安全身份上下文、主数据、动态表单和隔离上传
- 进度：6/13 个 G1 任务、23/101 个总任务完成
- 风险：TAX-001 本地验收已通过，仍需受保护 PR 的托管质量/容器检查

## 正在进行

| Task    | Owner                | Started    | Target            | Status     | Notes                                                  |
| ------- | -------------------- | ---------- | ----------------- | ---------- | ------------------------------------------------------ |
| TAX-001 | @songjiahang676-cell | 2026-07-28 | protected task PR | validating | 地区/分类树与别名/33 files/121 tests 通过；等待托管 CI |

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
| AUTH-001 protected merge        | PR #3 / run `30187968381`          | merged `89c7f8b`；quality + non-root images passed   | 2026-07-25 |
| AUTH-002 local quality          | `pnpm ci:quality`                  | passed：24 files / 81 tests / 8 builds               | 2026-07-25 |
| AUTH-002 PostgreSQL abuse tests | empty deploy + integration/upgrade | passed：5 migrations、31 database tests              | 2026-07-25 |
| AUTH-002 protected merge        | PR #4 / run `30188776254`          | merged `22d9120`；quality + non-root images passed   | 2026-07-26 |
| AUTH-003 local quality          | `pnpm ci:quality`                  | passed：26 files / 92 tests / 8 builds               | 2026-07-28 |
| AUTH-003 database lifecycle     | empty deploy + integration/upgrade | passed：6 migrations、33 database tests              | 2026-07-28 |
| AUTH-003 protected merge        | PR #5 / run `30384193833`          | merged `9c66b87`；quality + non-root images passed   | 2026-07-28 |
| API-004 local quality           | `pnpm ci:quality` + policy matrix  | passed：27 files / 99 tests / 8 builds               | 2026-07-28 |
| API-004 protected merge         | PR #6 / run `30386104555`          | merged `0af5f99`；quality + non-root images passed   | 2026-07-28 |
| ORG-001 local quality           | `pnpm ci:quality` + role matrix    | passed：30 files / 111 tests / 8 builds              | 2026-07-28 |
| ORG-001 PostgreSQL scope tests  | 11 database files / 36 tests       | atomic Owner、retry、cross-org、role-scoped reads    | 2026-07-28 |
| ORG-001 protected merge         | PR #7 / run `30388093140`          | merged `ab09c81`；quality + non-root images passed   | 2026-07-28 |
| TAX-001 local quality           | `pnpm ci:quality` + taxonomy tests | passed：33 files / 121 tests / 8 builds              | 2026-07-28 |
| TAX-001 database lifecycle      | deploy + seed + baseline + upgrade | 7 migrations；39 DB tests；17/21 regions/aliases     | 2026-07-28 |

## Decisions / Blocks

- ADR-0006：正式公开上线后 12 个月全站免费；收费与自动充值延后到 Gate 5，默认关闭。
- 项目负责人于 2026-07-25 明确授权公开仓库；公开后立即启用 `main` 强制保护。
- Gate 0 已由受保护 PR #1 合并；AUTH-001/002/003/API-004/ORG-001 已由受保护 PR #3/#4/#5/#6/#7 合并；TAX-001 本地验收完成。
- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

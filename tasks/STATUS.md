# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G1 Identity / Taxonomy / Media
- 目标：安全身份上下文、主数据、动态表单和隔离上传
- 进度：11/13 个 G1 任务、29/101 个总任务完成
- 风险：EVT-001 本地验收已通过，真实 Redis/BullMQ 投递留给受保护托管 CI 强制执行；真实短信/邮件提供商适配器仍由 NOTIF-001 提供

## 正在进行

| Task    | Owner                | Started    | Target            | Status                  | Notes                                                                  |
| ------- | -------------------- | ---------- | ----------------- | ----------------------- | ---------------------------------------------------------------------- |
| EVT-001 | @songjiahang676-cell | 2026-07-28 | protected task PR | local validation passed | Outbox claim/retry/idempotent publish/oldest-age metrics；托管 CI 待跑 |

## Gate Evidence

| Evidence                        | Link/Artifact                      | Result                                                               | Date       |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------------- | ---------- |
| Static architecture check       | `scripts/check-architecture.sh`    | passed：101 tasks、31 paths、52 schemas、36 models                   | 2026-07-25 |
| Hosted quality gate             | GitHub Actions run `30186103447`   | passed：locked install、51 tests、7 builds、E2E                      | 2026-07-25 |
| Four image build/runtime health | GitHub Actions job `89751350551`   | passed：4 images、`node` user、4 readiness endpoints                 | 2026-07-25 |
| Local complete quality          | `pnpm ci:quality`                  | passed：real PostgreSQL integration included                         | 2026-07-25 |
| Failed clean-checkout evidence  | Runs `30185510707` / `30185679624` | failures diagnosed and fixed                                         | 2026-07-25 |
| Protected green PR              | PR #1 / run `30186346943`          | both required checks passed；merge state clean                       | 2026-07-25 |
| Protected failing PR            | closed PR #2 / run `30187032798`   | required quality check failed；merge state blocked                   | 2026-07-25 |
| `main` branch protection        | GitHub branch protection API       | PR + strict checks + conversations；admin enforced                   | 2026-07-25 |
| Gate 0 protected merge          | PR #1 / run `30187153269`          | merged；final head quality + four-image smoke passed                 | 2026-07-25 |
| AUTH-001 local quality          | `pnpm ci:quality`                  | passed：22 files / 66 tests / 8 builds                               | 2026-07-25 |
| AUTH-001 database lifecycle     | empty deploy + upgrade + baseline  | passed：4 migrations、hash/rotation/expiry/logout                    | 2026-07-25 |
| AUTH-001 protected merge        | PR #3 / run `30187968381`          | merged `89c7f8b`；quality + non-root images passed                   | 2026-07-25 |
| AUTH-002 local quality          | `pnpm ci:quality`                  | passed：24 files / 81 tests / 8 builds                               | 2026-07-25 |
| AUTH-002 PostgreSQL abuse tests | empty deploy + integration/upgrade | passed：5 migrations、31 database tests                              | 2026-07-25 |
| AUTH-002 protected merge        | PR #4 / run `30188776254`          | merged `22d9120`；quality + non-root images passed                   | 2026-07-26 |
| AUTH-003 local quality          | `pnpm ci:quality`                  | passed：26 files / 92 tests / 8 builds                               | 2026-07-28 |
| AUTH-003 database lifecycle     | empty deploy + integration/upgrade | passed：6 migrations、33 database tests                              | 2026-07-28 |
| AUTH-003 protected merge        | PR #5 / run `30384193833`          | merged `9c66b87`；quality + non-root images passed                   | 2026-07-28 |
| API-004 local quality           | `pnpm ci:quality` + policy matrix  | passed：27 files / 99 tests / 8 builds                               | 2026-07-28 |
| API-004 protected merge         | PR #6 / run `30386104555`          | merged `0af5f99`；quality + non-root images passed                   | 2026-07-28 |
| ORG-001 local quality           | `pnpm ci:quality` + role matrix    | passed：30 files / 111 tests / 8 builds                              | 2026-07-28 |
| ORG-001 PostgreSQL scope tests  | 11 database files / 36 tests       | atomic Owner、retry、cross-org、role-scoped reads                    | 2026-07-28 |
| ORG-001 protected merge         | PR #7 / run `30388093140`          | merged `ab09c81`；quality + non-root images passed                   | 2026-07-28 |
| TAX-001 local quality           | `pnpm ci:quality` + taxonomy tests | passed：33 files / 121 tests / 8 builds                              | 2026-07-28 |
| TAX-001 database lifecycle      | deploy + seed + baseline + upgrade | 7 migrations；39 DB tests；17/21 regions/aliases                     | 2026-07-28 |
| TAX-001 protected merge         | PR #8 / run `30389838047`          | merged `d622f74`；quality + non-root images passed                   | 2026-07-28 |
| TAX-002 local quality           | `pnpm ci:quality` + form tests     | passed：36 files / 131 tests / 8 builds                              | 2026-07-28 |
| TAX-002 database lifecycle      | deploy + seed + baseline + upgrade | 8 migrations；42 DB tests；58 schemas / 93 fields                    | 2026-07-28 |
| TAX-002 protected merge         | PR #9 / run `30391936500`          | merged `59218aa`；quality + non-root images passed                   | 2026-07-28 |
| TAX-002 final main quality      | GitHub Actions run `30392308720`   | merged head quality passed                                           | 2026-07-28 |
| MEDIA-001 local quality         | `pnpm ci:quality` + upload tests   | passed：40 files / 146 tests / 8 builds                              | 2026-07-28 |
| MEDIA-001 database lifecycle    | deploy + integration + baseline    | 9 migrations；46 DB tests；quota concurrency passed                  | 2026-07-28 |
| MEDIA-001 protected merge       | PR #10 / run `30393901014`         | merged `aadddcf`；quality + non-root images passed                   | 2026-07-28 |
| MEDIA-001 final main quality    | GitHub Actions run `30394324273`   | merged head quality + non-root images passed                         | 2026-07-28 |
| ADMIN-001 local quality         | `pnpm ci:quality` + Admin tests    | passed：41 files / 152 tests / 8 builds                              | 2026-07-28 |
| ADMIN-001 database lifecycle    | deploy + integration + baseline    | 10 migrations；47 DB tests；9 constraint negatives                   | 2026-07-28 |
| ADMIN-001 browser/CSP           | Chromium desktop/mobile + in-app   | 6/6 E2E；nonce hydration、双语、noindex/no-store passed              | 2026-07-28 |
| ADMIN-001 protected merge       | PR #11 / run `30396556334`         | merged `8058597`；quality + non-root images passed                   | 2026-07-28 |
| AUTH-005 local quality          | `pnpm ci:quality` + MFA tests      | passed：44 files / 165 tests / 8 builds                              | 2026-07-28 |
| AUTH-005 database lifecycle     | deploy + integration + baseline    | 11 migrations；49 DB tests；11 constraint negatives                  | 2026-07-28 |
| AUTH-005 browser/runtime        | Chromium desktop/mobile + runtime  | 6/6 E2E；API observability check passed                              | 2026-07-28 |
| AUTH-005 protected merge        | PR #12 / run `30398506529`         | merged `f6d7242`；quality + non-root images passed                   | 2026-07-28 |
| MFA tamper-test stabilization   | PR #13 / run `30401011927`         | merged `ca506c8`；byte-level auth-tag mutation verified              | 2026-07-28 |
| AUTH-004 local quality          | `pnpm ci:quality` + password tests | passed：48 files / 179 tests / 8 builds                              | 2026-07-28 |
| AUTH-004 database lifecycle     | deploy + integration + baseline    | 12 migrations；52 DB tests；13 constraint negatives                  | 2026-07-28 |
| AUTH-004 browser/runtime        | Chromium desktop/mobile + runtime  | 6/6 E2E；API observability check passed                              | 2026-07-28 |
| AUTH-004 protected merge        | PR #14 / run `30402997906`         | merged `b4d9474`；quality + non-root images passed                   | 2026-07-28 |
| EVT-001 local quality           | `pnpm ci:quality`                  | passed：51 files / 186 tests / 8 builds；1 Redis integration skipped | 2026-07-28 |
| EVT-001 database lifecycle      | deploy + integration + baseline    | 13 migrations；54 DB tests；16 constraint negatives                  | 2026-07-28 |
| EVT-001 browser/runtime         | Chromium desktop/mobile + runtime  | 6/6 E2E；API observability and architecture passed                   | 2026-07-28 |

## Decisions / Blocks

- ADR-0006：正式公开上线后 12 个月全站免费；收费与自动充值延后到 Gate 5，默认关闭。
- 项目负责人于 2026-07-25 明确授权公开仓库；公开后立即启用 `main` 强制保护。
- Gate 0 已由受保护 PR #1 合并；AUTH-001/002/003/API-004/ORG-001/TAX-001/TAX-002/MEDIA-001/ADMIN-001/AUTH-005 已由受保护 PR #3–#12 合并；AUTH-005 的 MFA tamper 测试稳定性修复另由 PR #13 合并；AUTH-004 已由受保护 PR #14 / run `30402997906` 合并为 `b4d9474`。
- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

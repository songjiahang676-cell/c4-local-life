# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G2 Listings / Moderation
- 目标：先用 Rental 证明草稿、审核、发布与过期垂直链，再复用到其余四类
- 进度：10/16 个 G2 任务、40/101 个总任务完成
- 风险：`LIST-006` 已通过 PR #26 首轮托管门禁并等待证据 head 复验/受保护合并；Windows 中等完整性进程不能创建 Next standalone symlink，Linux 托管门禁已完成完整构建；生产招聘政策词库、最低工资展示细则、抽检比例、SLA 和原因码仍需运营/法律确认，当前规则 v2 只把政策风险命中送入人工队列而不自动处罚

## 正在进行

| Task     | Owner                | Started    | Target | Status       | Notes                                                      |
| -------- | -------------------- | ---------- | ------ | ------------ | ---------------------------------------------------------- |
| LIST-006 | @songjiahang676-cell | 2026-07-30 | PR #26 | hosted green | Job 薪资/岗位字段、政策确认、审核、公开/过期与中英移动 E2E |

## Gate Evidence

| Evidence                        | Link/Artifact                         | Result                                                                     | Date       |
| ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| Static architecture check       | `scripts/check-architecture.sh`       | passed：101 tasks、31 paths、52 schemas、36 models                         | 2026-07-25 |
| Hosted quality gate             | GitHub Actions run `30186103447`      | passed：locked install、51 tests、7 builds、E2E                            | 2026-07-25 |
| Four image build/runtime health | GitHub Actions job `89751350551`      | passed：4 images、`node` user、4 readiness endpoints                       | 2026-07-25 |
| Local complete quality          | `pnpm ci:quality`                     | passed：real PostgreSQL integration included                               | 2026-07-25 |
| Failed clean-checkout evidence  | Runs `30185510707` / `30185679624`    | failures diagnosed and fixed                                               | 2026-07-25 |
| Protected green PR              | PR #1 / run `30186346943`             | both required checks passed；merge state clean                             | 2026-07-25 |
| Protected failing PR            | closed PR #2 / run `30187032798`      | required quality check failed；merge state blocked                         | 2026-07-25 |
| `main` branch protection        | GitHub branch protection API          | PR + strict checks + conversations；admin enforced                         | 2026-07-25 |
| Gate 0 protected merge          | PR #1 / run `30187153269`             | merged；final head quality + four-image smoke passed                       | 2026-07-25 |
| AUTH-001 local quality          | `pnpm ci:quality`                     | passed：22 files / 66 tests / 8 builds                                     | 2026-07-25 |
| AUTH-001 database lifecycle     | empty deploy + upgrade + baseline     | passed：4 migrations、hash/rotation/expiry/logout                          | 2026-07-25 |
| AUTH-001 protected merge        | PR #3 / run `30187968381`             | merged `89c7f8b`；quality + non-root images passed                         | 2026-07-25 |
| AUTH-002 local quality          | `pnpm ci:quality`                     | passed：24 files / 81 tests / 8 builds                                     | 2026-07-25 |
| AUTH-002 PostgreSQL abuse tests | empty deploy + integration/upgrade    | passed：5 migrations、31 database tests                                    | 2026-07-25 |
| AUTH-002 protected merge        | PR #4 / run `30188776254`             | merged `22d9120`；quality + non-root images passed                         | 2026-07-26 |
| AUTH-003 local quality          | `pnpm ci:quality`                     | passed：26 files / 92 tests / 8 builds                                     | 2026-07-28 |
| AUTH-003 database lifecycle     | empty deploy + integration/upgrade    | passed：6 migrations、33 database tests                                    | 2026-07-28 |
| AUTH-003 protected merge        | PR #5 / run `30384193833`             | merged `9c66b87`；quality + non-root images passed                         | 2026-07-28 |
| API-004 local quality           | `pnpm ci:quality` + policy matrix     | passed：27 files / 99 tests / 8 builds                                     | 2026-07-28 |
| API-004 protected merge         | PR #6 / run `30386104555`             | merged `0af5f99`；quality + non-root images passed                         | 2026-07-28 |
| ORG-001 local quality           | `pnpm ci:quality` + role matrix       | passed：30 files / 111 tests / 8 builds                                    | 2026-07-28 |
| ORG-001 PostgreSQL scope tests  | 11 database files / 36 tests          | atomic Owner、retry、cross-org、role-scoped reads                          | 2026-07-28 |
| ORG-001 protected merge         | PR #7 / run `30388093140`             | merged `ab09c81`；quality + non-root images passed                         | 2026-07-28 |
| TAX-001 local quality           | `pnpm ci:quality` + taxonomy tests    | passed：33 files / 121 tests / 8 builds                                    | 2026-07-28 |
| TAX-001 database lifecycle      | deploy + seed + baseline + upgrade    | 7 migrations；39 DB tests；17/21 regions/aliases                           | 2026-07-28 |
| TAX-001 protected merge         | PR #8 / run `30389838047`             | merged `d622f74`；quality + non-root images passed                         | 2026-07-28 |
| TAX-002 local quality           | `pnpm ci:quality` + form tests        | passed：36 files / 131 tests / 8 builds                                    | 2026-07-28 |
| TAX-002 database lifecycle      | deploy + seed + baseline + upgrade    | 8 migrations；42 DB tests；58 schemas / 93 fields                          | 2026-07-28 |
| TAX-002 protected merge         | PR #9 / run `30391936500`             | merged `59218aa`；quality + non-root images passed                         | 2026-07-28 |
| TAX-002 final main quality      | GitHub Actions run `30392308720`      | merged head quality passed                                                 | 2026-07-28 |
| MEDIA-001 local quality         | `pnpm ci:quality` + upload tests      | passed：40 files / 146 tests / 8 builds                                    | 2026-07-28 |
| MEDIA-001 database lifecycle    | deploy + integration + baseline       | 9 migrations；46 DB tests；quota concurrency passed                        | 2026-07-28 |
| MEDIA-001 protected merge       | PR #10 / run `30393901014`            | merged `aadddcf`；quality + non-root images passed                         | 2026-07-28 |
| MEDIA-001 final main quality    | GitHub Actions run `30394324273`      | merged head quality + non-root images passed                               | 2026-07-28 |
| ADMIN-001 local quality         | `pnpm ci:quality` + Admin tests       | passed：41 files / 152 tests / 8 builds                                    | 2026-07-28 |
| ADMIN-001 database lifecycle    | deploy + integration + baseline       | 10 migrations；47 DB tests；9 constraint negatives                         | 2026-07-28 |
| ADMIN-001 browser/CSP           | Chromium desktop/mobile + in-app      | 6/6 E2E；nonce hydration、双语、noindex/no-store passed                    | 2026-07-28 |
| ADMIN-001 protected merge       | PR #11 / run `30396556334`            | merged `8058597`；quality + non-root images passed                         | 2026-07-28 |
| AUTH-005 local quality          | `pnpm ci:quality` + MFA tests         | passed：44 files / 165 tests / 8 builds                                    | 2026-07-28 |
| AUTH-005 database lifecycle     | deploy + integration + baseline       | 11 migrations；49 DB tests；11 constraint negatives                        | 2026-07-28 |
| AUTH-005 browser/runtime        | Chromium desktop/mobile + runtime     | 6/6 E2E；API observability check passed                                    | 2026-07-28 |
| AUTH-005 protected merge        | PR #12 / run `30398506529`            | merged `f6d7242`；quality + non-root images passed                         | 2026-07-28 |
| MFA tamper-test stabilization   | PR #13 / run `30401011927`            | merged `ca506c8`；byte-level auth-tag mutation verified                    | 2026-07-28 |
| AUTH-004 local quality          | `pnpm ci:quality` + password tests    | passed：48 files / 179 tests / 8 builds                                    | 2026-07-28 |
| AUTH-004 database lifecycle     | deploy + integration + baseline       | 12 migrations；52 DB tests；13 constraint negatives                        | 2026-07-28 |
| AUTH-004 browser/runtime        | Chromium desktop/mobile + runtime     | 6/6 E2E；API observability check passed                                    | 2026-07-28 |
| AUTH-004 protected merge        | PR #14 / run `30402997906`            | merged `b4d9474`；quality + non-root images passed                         | 2026-07-28 |
| EVT-001 local quality           | `pnpm ci:quality`                     | passed：51 files / 186 tests / 8 builds；1 Redis integration skipped       | 2026-07-28 |
| EVT-001 database lifecycle      | deploy + integration + baseline       | 13 migrations；54 DB tests；16 constraint negatives                        | 2026-07-28 |
| EVT-001 browser/runtime         | Chromium desktop/mobile + runtime     | 6/6 E2E；API observability and architecture passed                         | 2026-07-28 |
| EVT-001 protected checks        | PR #15 / run `30404864972`            | final head real Redis quality + non-root images passed                     | 2026-07-28 |
| EVT-001 protected merge         | PR #15 / merge `490efa4`              | protected merge completed                                                  | 2026-07-28 |
| MEDIA-002 local database        | fresh 14-migration empty database     | baseline 19 negatives；upgrade preserved sentinel；57 tests passed         | 2026-07-28 |
| MEDIA-002 local quality         | `pnpm ci:quality`                     | 55 files / 203 tests passed；Redis/ClamAV skipped；Admin standalone EPERM  | 2026-07-28 |
| MEDIA-002 protected checks      | PR #16 / run `30406971001`            | 57 files / 205 tests with real Redis/ClamAV；build/E2E/4 images passed     | 2026-07-28 |
| MEDIA-002 final checks          | PR #16 / run `30407394217`            | final head quality + four non-root images passed                           | 2026-07-28 |
| MEDIA-002 protected merge       | PR #16 / merge `d4abece`              | protected merge completed                                                  | 2026-07-28 |
| LIST-001 API domain tests       | API typecheck/lint/test               | 19 files / 97 tests passed；8 Listing state-machine groups                 | 2026-07-28 |
| LIST-001 database integration   | 14 migrations / real PostgreSQL       | status current；17 files / 57 tests passed                                 | 2026-07-28 |
| LIST-001 local quality          | `pnpm ci:quality`                     | 56 files / 211 tests；9 typechecks/lints；8 builds passed                  | 2026-07-28 |
| LIST-001 browser/runtime        | Chromium desktop/mobile               | standalone preparation and 6/6 E2E passed                                  | 2026-07-28 |
| LIST-001 protected checks       | PR #17 / run `30408426707`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-28 |
| LIST-001 final checks           | PR #17 / run `30408759770`            | final head quality + four non-root images passed                           | 2026-07-28 |
| LIST-001 protected merge        | PR #17 / merge `c1709a7`              | protected merge completed                                                  | 2026-07-28 |
| LIST-002 database projections   | 18 database files / 61 tests          | public/owner/moderator scope and PII-negative tests passed                 | 2026-07-28 |
| LIST-002 local quality          | `pnpm ci:quality`                     | 57 files / 215 tests；9 typechecks/lints；8 builds passed                  | 2026-07-28 |
| LIST-002 browser/runtime        | Chromium desktop/mobile               | observability runtime and 6/6 E2E passed                                   | 2026-07-28 |
| LIST-002 architecture           | `scripts/check-architecture.sh`       | 101 tasks、47 models、44 paths、89 schemas passed                          | 2026-07-28 |
| LIST-002 protected checks       | PR #18 / run `30409724740`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-28 |
| LIST-002 final checks           | PR #18 / run `30410107716`            | final head quality + four non-root images passed                           | 2026-07-28 |
| LIST-002 protected merge        | PR #18 / merge `a8db956`              | protected merge completed                                                  | 2026-07-28 |
| LIST-003 database lifecycle     | fresh 15-migration empty database     | baseline 22 negatives；upgrade preserved sentinel；64 DB tests passed      | 2026-07-29 |
| LIST-003 local quality          | `pnpm ci:quality`                     | 61 files / 226 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| LIST-003 browser/runtime        | Chromium desktop/mobile               | observability runtime and 6/6 E2E passed                                   | 2026-07-29 |
| LIST-003 architecture           | `scripts/check-architecture.sh`       | 101 tasks、47 models、44 paths、98 schemas passed                          | 2026-07-29 |
| LIST-003 protected checks       | PR #19 / run `30412033239`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-29 |
| LIST-003 final checks           | PR #19 / run `30412407859`            | evidence head quality + four non-root images passed                        | 2026-07-29 |
| LIST-003 protected merge        | PR #19 / merge `c9a6db2`              | protected merge completed                                                  | 2026-07-29 |
| LIST-004 database lifecycle     | fresh 16-migration empty database     | baseline 23 negatives；upgrade preserved sentinel；65 DB tests passed      | 2026-07-29 |
| LIST-004 local quality          | `pnpm ci:quality`                     | 61 files / 235 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| LIST-004 browser/runtime        | Chromium desktop/mobile               | production build and 8/8 E2E passed                                        | 2026-07-29 |
| LIST-004 architecture           | `scripts/check-architecture.sh`       | 101 tasks、47 models、45 paths、99 schemas passed                          | 2026-07-29 |
| LIST-004 protected checks       | PR #20 / run `30414690267`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-29 |
| LIST-004 final checks           | PR #20 / run `30415124557`            | evidence head quality + four non-root images passed                        | 2026-07-29 |
| LIST-004 protected merge        | PR #20 / merge `fd27e19`              | protected squash merge completed                                           | 2026-07-29 |
| MOD-001 database lifecycle      | 17 migrations / real PostgreSQL       | baseline 27 negatives；upgrade sentinel；20 files / 67 tests passed        | 2026-07-29 |
| MOD-001 local quality           | `pnpm ci:quality`                     | 63 files / 243 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| MOD-001 runtime/browser         | API runtime + Chromium desktop/mobile | canonical contract and 8/8 production E2E passed                           | 2026-07-29 |
| MOD-001 architecture            | `scripts/check-architecture.sh`       | 101 tasks、49 models、45 paths、100 schemas passed                         | 2026-07-29 |
| MOD-001 protected checks        | PR #21 / run `30416761469`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-29 |
| MOD-001 final checks            | PR #21 / run `30417062067`            | evidence head quality + four non-root images passed                        | 2026-07-29 |
| MOD-001 protected merge         | PR #21 / merge `d9f632d`              | protected squash merge completed                                           | 2026-07-29 |
| ADMIN-002 database lifecycle    | fresh 18-migration empty database     | baseline 31 negatives；upgrade redacted sentinel；69 DB tests passed       | 2026-07-29 |
| ADMIN-002 local quality         | `pnpm ci:quality`                     | 69 files / 263 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| ADMIN-002 runtime/browser       | API runtime + Chromium desktop/mobile | canonical contract and 8/8 production E2E passed                           | 2026-07-29 |
| ADMIN-002 architecture          | `scripts/check-architecture.sh`       | 101 tasks、50 models、46 paths、108 schemas passed                         | 2026-07-29 |
| ADMIN-002 protected checks      | PR #22 / run `30419424360`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-29 |
| ADMIN-002 final checks          | PR #22 / run `30419743207`            | evidence head quality + four non-root images passed                        | 2026-07-29 |
| ADMIN-002 protected merge       | PR #22 / merge `cb02bda`              | protected squash merge completed                                           | 2026-07-29 |
| LIST-005 database lifecycle     | fresh 19-migration empty database     | baseline 31 negatives；upgrade sentinel；72 DB tests passed                | 2026-07-29 |
| LIST-005 local quality          | `pnpm ci:quality`                     | 72 files / 271 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| LIST-005 runtime/browser        | API runtime + Chromium desktop/mobile | canonical contract and 8/8 production E2E passed                           | 2026-07-29 |
| LIST-005 architecture           | `scripts/check-architecture.sh`       | 101 tasks、50 models、47 paths、109 schemas passed                         | 2026-07-29 |
| LIST-005 protected checks       | PR #23 / run `30430161567`            | real services、Linux build/E2E and four non-root images passed             | 2026-07-29 |
| LIST-005 final checks           | PR #23 / run `30430614404`            | evidence head quality + four non-root images passed                        | 2026-07-29 |
| LIST-005 protected merge        | PR #23 / merge `7a42b00`              | protected squash merge completed                                           | 2026-07-29 |
| NOTIF-001 database lifecycle    | fresh 20-migration empty database     | baseline 33 negatives；upgrade sentinel；75 DB tests passed                | 2026-07-29 |
| NOTIF-001 local quality         | type/lint/test/build + static checks  | 75 files / 302 tests；9 typechecks/lints；8 builds passed                  | 2026-07-29 |
| NOTIF-001 runtime/browser       | API runtime + Chromium desktop/mobile | canonical contract and notification flow；10/10 production E2E passed      | 2026-07-29 |
| NOTIF-001 architecture          | `scripts/check-architecture.sh`       | 101 tasks、51 models、49 paths、113 schemas passed                         | 2026-07-29 |
| NOTIF-001 protected checks      | PR #24 / run `30434003970`            | 304 real-service tests、Linux build/E2E and four non-root images passed    | 2026-07-29 |
| NOTIF-001 final checks          | PR #24 / run `30435034353`            | evidence head quality + four non-root images passed                        | 2026-07-30 |
| NOTIF-001 protected merge       | PR #24 / merge `19a6176`              | protected squash merge completed                                           | 2026-07-30 |
| ORG-002 database lifecycle      | fresh 21-migration empty database     | baseline 33 negatives；upgrade sentinel；78 DB tests passed                | 2026-07-30 |
| ORG-002 local quality           | type/lint/test/build + static checks  | 78 files / 318 tests；2 service skips；9 typechecks/lints；8 builds passed | 2026-07-30 |
| ORG-002 runtime/browser         | API runtime + Chromium desktop/mobile | canonical contract and private notification flow；10/10 E2E passed         | 2026-07-30 |
| ORG-002 architecture            | `scripts/check-architecture.sh`       | 101 tasks、53 models、57 paths、123 schemas、36 JSON files passed          | 2026-07-30 |
| ORG-002 protected checks        | PR #25 / run `30438535063`            | 320 real-service tests、Linux build/E2E and four non-root images passed    | 2026-07-30 |
| ORG-002 final checks            | PR #25 / run `30439069763`            | evidence head quality + four non-root images passed                        | 2026-07-30 |
| ORG-002 protected merge         | PR #25 / merge `0ac0b6e`              | protected squash merge completed                                           | 2026-07-30 |
| LIST-006 database lifecycle     | fresh 22-migration empty database     | baseline 34 negatives；upgrade sentinel；22 files / 80 DB tests passed     | 2026-07-30 |
| LIST-006 local quality          | `pnpm ci:quality`                     | 78 files / 324 tests；2 service skips；9 typechecks/lints；8 builds passed | 2026-07-30 |
| LIST-006 runtime/browser        | production Chromium desktop/mobile    | Job create/save/submit and existing journeys；12/12 E2E passed             | 2026-07-30 |
| LIST-006 architecture           | `scripts/check-architecture.sh`       | 101 tasks、53 models、57 paths、123 schemas、36 JSON files passed          | 2026-07-30 |
| LIST-006 protected checks       | PR #26 / run `30441538770`            | 326 real-service tests、Linux build/E2E and four non-root images passed    | 2026-07-30 |

## Decisions / Blocks

- ADR-0006：正式公开上线后 12 个月全站免费；收费与自动充值延后到 Gate 5，默认关闭。
- 项目负责人于 2026-07-25 明确授权公开仓库；公开后立即启用 `main` 强制保护。
- Gate 0 已由受保护 PR #1 合并；AUTH-001/002/003/API-004/ORG-001/TAX-001/TAX-002/MEDIA-001/ADMIN-001/AUTH-005 已由受保护 PR #3–#12 合并；AUTH-005 的 MFA tamper 测试稳定性修复另由 PR #13 合并；AUTH-004 已由受保护 PR #14 / run `30402997906` 合并为 `b4d9474`；EVT-001 已由受保护 PR #15 / final run `30404864972` 合并为 `490efa4`；MEDIA-002 已由受保护 PR #16 / final run `30407394217` 合并为 `d4abece`，Gate 1 实施主线与退出条件完成；LIST-001 已由受保护 PR #17 / final run `30408759770` 合并为 `c1709a7`；LIST-002 已由受保护 PR #18 / final run `30410107716` 合并为 `a8db956`；LIST-003 已由受保护 PR #19 / final run `30412407859` 合并为 `c9a6db2`；LIST-004 已由受保护 PR #20 / final run `30415124557` 合并为 `fd27e19`；MOD-001 已由受保护 PR #21 / final run `30417062067` 合并为 `d9f632d`；ADMIN-002 已由受保护 PR #22 / final run `30419743207` 合并为 `cb02bda`；LIST-005 已由受保护 PR #23 / final run `30430614404` 合并为 `7a42b00`；NOTIF-001 已由受保护 PR #24 / final run `30435034353` 合并为 `19a6176`。
- `ORG-002` 保留原 G1/P1 标签并已由 PR #25 受保护合并；现按
  `IMPLEMENTATION_SEQUENCE.md` 执行 `LIST-006`。`MEDIA-003` 仍属于 G4 受限验证文件。
- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

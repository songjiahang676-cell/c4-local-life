# 项目状态模板

> 此文件由实施团队开始工作后维护；架构包交付时没有伪造完成项。

## 当前 Gate

- Gate：G0 Foundation
- 目标：可重复安装、校验、构建、测试和部署基础
- 风险：依赖尚未在本离线环境安装；需要在可联网环境生成 `pnpm-lock.yaml`

## 正在进行

| Task    | Owner | Started | Target | Status | Notes    |
| ------- | ----- | ------- | ------ | ------ | -------- |
| FND-001 | TBD   | —       | —      | todo   | 第一任务 |

## Gate Evidence

| Evidence                  | Link/Artifact                   | Result                                         | Date       |
| ------------------------- | ------------------------------- | ---------------------------------------------- | ---------- |
| Static architecture check | `scripts/check-architecture.sh` | packaging environment passed；实施环境必须复跑 | 2026-07-21 |
| pnpm frozen install       | CI log                          | not run                                        | —          |
| Prisma validate           | CI log                          | not run                                        | —          |
| Typecheck/lint/test/build | CI log                          | not run                                        | —          |

## Decisions / Blocks

- 需要生产品牌域名与资产权属确认。
- 需要法律/运营确认高风险分类和数据保留期限。
- 需要选择短信、邮件、地图和支付生产账号。

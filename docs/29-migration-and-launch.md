# 29. 数据迁移、内容冷启动与上线

## 29.1 适用场景

若已有旧网站、Excel、数据库或商家名单，迁移必须作为独立项目处理。未知来源的数据不能直接导入公开生产，更不能自动制造用户账号或评价。

## 29.2 导入流水线

```text
Source Inventory
→ Legal/Consent Review
→ Extract to immutable staging
→ Normalize/Map
→ Validate/Quarantine
→ Deduplicate
→ Dry-run report
→ Import canonical DB
→ Media copy/scan
→ Moderation sampling
→ Search index
→ Reconciliation
```

每批次有 `import_batch_id`、来源、时间、hash、映射版本、记录数、失败、操作者和回滚策略。

## 29.3 来源审查

- 谁拥有数据和内容授权？
- 用户是否同意迁移及新的隐私/条款？
- 联系方式能否继续公开/营销？
- 评价是否真实、可验证、允许迁移？
- 内容是否过期、违法、重复或包含敏感 PII？
- 图片是否有版权和原始 EXIF？

无法确认时，只可作为内部线索/待认领档案，不能公开声称由该商家/用户发布。

## 29.4 映射与去重

- 城市/分类映射到稳定 ID，无法映射进入 quarantine。
- 用户按经验证邮箱/手机号匹配需谨慎，避免错误合并；优先邀请认领。
- Listing 使用来源 ID + source 唯一，内容/联系方式/图片 hash 做近似重复。
- 商家采用名称、地址、电话等匹配并人工复核冲突。
- 不迁移明文密码；要求重置/OTP 激活。

## 29.5 内容冷启动

上线前需要真实供给而非占位数字：

- 与少量可信招聘方、房东、商家、师傅合作导入/发布。
- 运营创建的 editorial collection 明确来源和时间。
- 首页没有可靠数据的模块隐藏，而非伪造统计/评分。
- 为首发城市设最低有效信息阈值，未达标不生成 SEO 城市页。
- 安全/帮助/政策内容中英完整。

## 29.6 上线阶段

### Internal Alpha

员工/合作方，测试完整发布、审核、搜索、消息和后台。生产级安全但可无公开 SEO。

### Closed Beta

邀请发布者 + 1–2 城市/少量分类。观察审核负荷、诈骗、搜索成功、首联时间和性能。

### Public Beta

扩大城市和用户；商业化可保持邀请制。启用 sitemap/SEO 的批准页面。

### GA

通过生产就绪验收、运营 SLA、安全/法律审查和恢复演练后开放。

## 29.7 灰度控制

Feature Flag 维度：环境、城市、listing type、用户 cohort、组织、角色。发布顺序通常：读取 → 创建草稿 → 提交 → 自动审批 → 商业化。任何新高风险类别先人工审核 100%，再根据数据降低比例。

## 29.8 Cutover 清单

- DNS/CDN/WAF/TLS、域名 canonical、robots/sitemap。
- 数据库迁移、备份点、搜索索引、对象桶策略。
- 生产密钥/provider webhook、邮件域/SPF/DKIM/DMARC。
- 隐私/条款/内容/退款/广告政策链接。
- Admin 用户、MFA、权限、值班和沟通模板。
- Dashboard/告警、状态页、Runbook。
- 真实首页配置、广告 fallback、无占位信息。
- Rollback 决策点和负责人。

## 29.9 上线后 72 小时

发布窗口加强值班；密切监控错误、搜索、审核、消息垃圾、付款、SEO 抓取和成本。避免同时上线大量新 Feature Flag。每日两次 Go/No-Go 复盘，并保持快速关闭高风险入口能力。

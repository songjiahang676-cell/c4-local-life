# 27. 路由目录

`[locale]` 为 `zh-Hans` 或 `en`；`[city]`、`[category]` 是规范 slug；私有页面全部 noindex。

## 27.1 公开 Web

| Route                            | 模板/说明                | Auth | SEO            |
| -------------------------------- | ------------------------ | ---- | -------------- |
| `/`                              | locale 选择/重定向       | 否   | noindex 或短页 |
| `/[locale]`                      | 地域化首页               | 否   | index          |
| `/[locale]/search`               | 全站搜索                 | 否   | noindex        |
| `/[locale]/jobs`                 | 招聘频道                 | 否   | index          |
| `/[locale]/jobs/[city]`          | 城市招聘                 | 否   | 白名单 index   |
| `/[locale]/jobs/[city]/[slugId]` | 招聘详情                 | 否   | 条件 index     |
| `/[locale]/rentals...`           | 租房列表/详情            | 否   | 同上           |
| `/[locale]/transfers...`         | 转让列表/详情            | 否   | 同上           |
| `/[locale]/marketplace...`       | 二手列表/详情            | 否   | 同上           |
| `/[locale]/services...`          | 服务信息列表/详情        | 否   | 同上           |
| `/[locale]/providers`            | 师傅目录                 | 否   | index          |
| `/[locale]/providers/[slugId]`   | 师傅档案                 | 否   | 条件 index     |
| `/[locale]/businesses`           | 商家目录                 | 否   | index          |
| `/[locale]/businesses/[slug]`    | 商家档案                 | 否   | 条件 index     |
| `/[locale]/cities/[city]`        | 城市门户                 | 否   | index          |
| `/[locale]/deals`                | 优惠（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/questions`            | 问答（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/community`            | 论坛（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/events`               | 活动（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/suppliers`            | 国内货源（Phase 2/3）    | 否   | Feature Flag   |
| `/[locale]/help/*`               | 帮助与安全               | 否   | index          |
| `/[locale]/policies/*`           | 条款/隐私/内容/广告/退款 | 否   | index          |
| `/[locale]/about`                | 关于                     | 否   | index          |

五类详情路由可由统一内部 route builder 生成，公开 URL 保持垂直清晰。

## 27.2 发布与账户

| Route                                  | 说明           |
| -------------------------------------- | -------------- |
| `/[locale]/post`                       | 选择发布类型   |
| `/[locale]/post/[type]/new`            | 创建草稿/表单  |
| `/[locale]/post/[type]/[id]/edit`      | 编辑           |
| `/[locale]/post/[type]/[id]/preview`   | 私有预览       |
| `/[locale]/account`                    | 总览           |
| `/[locale]/account/listings`           | 我的信息       |
| `/[locale]/account/listings/[id]/edit` | 账号内草稿编辑 |
| `/[locale]/account/favorites`          | 收藏           |
| `/[locale]/account/messages`           | 会话列表       |
| `/[locale]/account/messages/[id]`      | 会话           |
| `/[locale]/account/notifications`      | 通知           |
| `/[locale]/account/orders`             | 订单           |
| `/[locale]/account/wallet`             | 积分/信用      |

当前五类规范创建路由为 `/[locale]/post/rental/new`、`/[locale]/post/job/new`、
`/[locale]/post/transfer/new`、`/[locale]/post/secondhand/new` 和
`/[locale]/post/service/new`；首页相应快速发布入口指向各自页面。它们均为 noindex 私有草稿页，
复用账号/locale/vertical 隔离恢复、动态 schema、READY 媒体绑定、强并发控制和幂等提交审核动作。
账号内草稿编辑路由由 `LIST-009` 使用，必须先从 owner API 读取精确 DRAFT 与 ETag；`type` 查询参数只
选择已实现的表单视图，不能用于推导 owner、授权或 Listing 类型事实。
| `/[locale]/account/organizations` | 组织与成员 |
| `/[locale]/account/profile` | 资料 |
| `/[locale]/account/verification` | 验证 |
| `/[locale]/account/security` | 会话/MFA |
| `/[locale]/account/privacy` | 数据请求/删除 |
| `/[locale]/auth/login` | 登录 |
| `/[locale]/auth/verify` | OTP 验证 |

## 27.3 Admin

```text
/admin
/admin/moderation/listings
/admin/moderation/reports
/admin/moderation/appeals
/admin/users
/admin/organizations
/admin/businesses
/admin/providers
/admin/taxonomy/regions
/admin/taxonomy/categories
/admin/config/homepage
/admin/config/rules
/admin/commerce/orders
/admin/commerce/refunds
/admin/commerce/ledger
/admin/ads/inventory
/admin/ads/campaigns
/admin/notifications
/admin/audit
/admin/system/jobs
/admin/system/health
```

Admin route 只是视图入口，权限以 API action 为准。没有权限的菜单不显示，直接访问仍必须返回 403。

## 27.4 路由规则

- Route builder 统一生成 canonical、locale switch 和 breadcrumb。
- 不使用标题作为唯一 ID；详情 slug 尾部包含短 ID 或稳定 key。
- 所有账户/Admin 页 `noindex`，响应设置防缓存私密 header。
- 旧 slug 用持久 redirect 表 301；违规/删除资源 404/410。
- 任意筛选 query 参数按 canonical 策略处理，不自动 index。

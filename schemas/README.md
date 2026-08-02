# JSON Schemas

- `listing-form.schema.json`：动态表单配置 envelope。
- `homepage-layout.schema.json`：运营可发布的首页模块白名单。
- `analytics-event.schema.json`：产品分析事件 envelope。
- `search-relevance.schema.json`：仅含纯合成文档和中英 relevance judgments 的离线评估集。

所有配置有版本、draft/preview/publish/rollback；服务端仍需业务校验，不能只信 schema/前端。

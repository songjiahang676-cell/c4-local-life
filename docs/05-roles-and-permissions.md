# 05. 角色、权限与授权模型

## 5.1 模型

采用 RBAC + ABAC：角色决定可执行动作集合，属性决定具体资源是否可操作。所有授权在 API 服务端执行，UI 仅用于减少无效入口。

属性包括：资源 owner、organization membership、组织角色、资源状态、城市/分类审核范围、验证等级、账户风险状态、订单关系和时间窗口。

## 5.2 平台角色

| 角色              | 典型权限                                     | 限制                             |
| ----------------- | -------------------------------------------- | -------------------------------- |
| Guest             | 浏览公开资源、搜索                           | 不可发布、收藏、联系、举报       |
| User              | 个人资料、草稿、发布、收藏、消息、举报、订单 | 仅自己的资源和会话               |
| Verified User     | 高风险分类或更高额度                         | 仍受规则和限频                   |
| Support           | 查看最小必要账户/会话元数据、协助恢复        | 默认不能看消息正文和验证原件     |
| Moderator         | 审核内容、处理举报、施加内容动作             | 不处理付款、不能改自身审计       |
| Senior Moderator  | 申诉、用户/组织高级限制                      | 高风险动作需双人确认             |
| Ad Ops            | 广告库存、素材审核、排期                     | 不能退款或改账本                 |
| Finance           | 订单、退款、对账、账本调整                   | 不审核内容；调整需理由和复核     |
| Taxonomy Admin    | 城市、分类、表单和首页编排                   | 发布前需版本/回滚                |
| Platform Admin    | 系统配置、角色授权、Feature Flag             | 强制 MFA，最小人数，所有动作审计 |
| Read-only Auditor | 只读审计和报告                               | 无写权限、导出受控               |

## 5.3 组织角色

| 角色    | 档案         | 信息           | 成员              | 订单/账单          | 分析              |
| ------- | ------------ | -------------- | ----------------- | ------------------ | ----------------- |
| OWNER   | 全部         | 全部           | 邀请/移除/转权    | 全部               | 查看              |
| ADMIN   | 编辑         | 全部           | 邀请/移除非 Owner | 查看/购买          | 查看              |
| EDITOR  | 编辑有限字段 | 创建/编辑/提交 | 无                | 无                 | 查看自身内容      |
| BILLING | 只读         | 只读           | 无                | 购买/发票/付款方式 | 财务报告          |
| ANALYST | 只读         | 只读           | 无                | 只读               | 查看/导出受控数据 |

组织中必须始终至少有一个 Owner。Owner 转移和组织删除需要近期认证；Billing 不能通过修改内容间接获得审核权限。

## 5.4 资源级规则示例

### 信息

- 草稿：Owner 或组织 Editor 以上可读写。
- 已提交：默认只读；允许撤回，或通过受控修订创建新版本。
- 已发布：Owner 可编辑，重大字段触发重新审核。
- 已下架：Owner 可查看原因和申诉，不可自行恢复。
- 已删除：普通界面不可见；审计/法律保留按策略访问。

### 会话

- 只有参与者可读取会话。
- Support 默认仅查看时间、参与者状态、举报标记和技术元数据；查看正文需工单理由和临时授权。
- 被屏蔽或限制的用户不能发新消息。
- 管理员不能使用后台 API 冒充用户发送消息。

### 评价

- 作者可在短时间窗口编辑；删除采用软删除和审核记录。
- 被评价组织不能修改评价，只能回复或举报。
- 审核员不能处理自己或所属组织相关的案件。

### 订单和账本

- User/组织 Billing 仅能查看自身订单。
- 退款由 Finance 或自动政策流程执行，必须引用原支付和幂等键。
- 账本调整至少需要原因码、工单、操作者和复核状态。

## 5.5 权限实现

- 身份解析：Session → User → status/risk → memberships。
- 控制器声明动作，例如 `listing:publish`。
- Policy service 接收 actor、action、resource context，返回 allow/deny 与原因码。
- Repository 查询尽量带 owner/org 条件，避免“先取全对象再判断”产生 IDOR。
- 后台高风险动作采用 step-up authentication 与可选双人审批。
- 权限结果可短时缓存，但用户状态、组织角色和封禁变更必须主动失效。

API 应用层的统一实现位于 `apps/api/src/common/authorization/`：

- `AuthContextGuard` 先解析 Cookie/Session，再为每个请求建立不可变 `RequestContext`。Actor 只包含 user/session ID、账户状态、验证徽章、显式全局权限和活动组织 membership，不携带显示名、联系方式、IP 或 token。
- 控制器使用 `@RequirePolicy("<domain>:<resource>:<action>")` 声明动作；全局 `AuthorizationGuard` 在进入控制器前执行已注册规则。未声明动作的公共路由不被误拦截，但任何未注册动作、重复注册或规则异常都失败关闭。
- `PolicyService` 返回内部 allow/deny 与稳定原因码；HTTP 边界只向未登录用户返回通用 401，向其他拒绝返回通用 403，不泄露资源、角色或组织是否存在。
- 对象级规则必须使用 Repository 已按 actor/tenant 约束取得的最小资源上下文（owner、organization、state、deleted），不得把客户端提交的 owner/org 当作授权事实。`ownerOrOrganizationPolicy` 是组合规则，不替代 Repository 的 scoped query。
- `/auth/session` 的 `permissions` 只用于客户端减少无效入口；服务端每次请求仍重新构建 Actor 并执行 Policy，客户端不得提交或覆盖权限。当前 ACTIVE 用户获得账户自助和 `listing:draft:create` 能力，LIMITED 用户仅保留账户资料/会话自助能力；Listing 草稿 POST 已由同名 Policy 动作强制执行。

## 5.6 权限测试最小矩阵

每个资源至少测试：未登录、资源拥有者、同组织不同角色、无关普通用户、受限用户、正确后台角色、错误后台角色、跨组织 ID、已删除/下架状态、批量接口部分越权。默认拒绝，未知动作不得隐式放行。

可复用测试 helper 位于 `apps/api/test/support/policy-matrix.ts`。新资源应以表驱动矩阵验证 allow/deny 和原因码，并至少包含跨组织、错误角色、受限账户、删除资源和缺失资源负例；HTTP 测试另外断言外部错误不会暴露内部 deny reason。

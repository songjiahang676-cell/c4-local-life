# 23. 内容分类与动态表单

## 23.1 分类树原则

分类树同时服务导航、表单、审核、搜索、SEO 和商业化，因此必须版本化且有稳定 ID。显示名称可变，ID/slug 的语义不能随意复用。

分类字段建议：

```text
id, parentId, listingType, slug
nameZhHans, nameEn
status, sortOrder, iconKey
formSchemaVersion, moderationTier
defaultExpiryDays, requiredVerificationLevel
seoTitle/Description per locale
allowedRegionTypes, promotionEligibility
```

## 23.2 首期分类建议

### 招聘

餐饮、仓库物流、办公室行政、销售客服、司机运输、美容美甲、建筑装修、教育培训、医疗护理、家政照护、技术/专业、其他。

关键字段：岗位、雇主、employment type、薪资 min/max/unit、地点、经验、语言、排班、远程、签证支持声明、福利。政策禁止歧视性条件和误导工资。

`LIST-006` 已把这组字段落为 Job v1 动态表单：通用 `title` 表示岗位，通用 `price`
表示最低薪资，`wageMax` 表示同周期最高薪资；允许 HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY，
且应用层和 PostgreSQL 都要求 `0 < min <= max`。`employerName`、`employmentType`、
`experienceLevel`、`remoteType`、`schedule` 必填，语言、签证支持声明和福利可选。
`employmentPolicyAcknowledged` 必须明确为 true，但属于 OWNER_ONLY，不进入公开详情或列表。

平台统一要求所有 Job 提供薪资范围，这是内容完整性规则，不代表平台判断某发布者的法律适用性。
加州官方材料说明就业反歧视义务覆盖招聘广告，且特定雇主的职位发布须包含 pay scale：
[California Civil Rights Department — Employment](https://calcivilrights.ca.gov/employment/)、
[California Labor Commissioner — Equal Pay Act FAQ](https://www.dir.ca.gov/dlse/California_Equal_Pay_Act.htm)。
规则仅把疑似歧视或误导内容送人工审核，不自动作出违法结论；正式政策和阈值仍须法律/运营批准。

### 租房

单间/主卧、整租公寓、独立屋、ADU/后屋、合租找室友、商业/仓库（可后续独立频道）、短租（需政策确认）。

关键字段：property type、bed/bath、租金、押金、available date、lease term、furnished、pets、parking、utilities、公开地点精度。公平住房规则强制。

### 转让

餐馆、奶茶/咖啡、美容美甲、零售、超市/便利、办公室、仓库/工厂、设备/库存、其他生意。

关键字段：asking price、monthly rent、lease remaining、面积、营业/收入声明（需免责声明）、inventory、转让原因、许可。财务数字需标“发布者提供，平台未验证”。

`LIST-007` 已落地 Transfer v1：通用 `price` 是正数 FIXED 要价，`businessType`、`monthlyRent`、
`leaseRemainingMonths`、`reasonForTransfer` 和发布者声明的 `licenseStatus` 必填，
`includesInventory` 可选。`financialDisclaimerAcknowledged` 必须明确为 true 且为 OWNER_ONLY。
分类策略固定人工审核，不能因未命中自动规则而直接公开。

### 二手

家具家电、电子数码、车辆配件（车辆整车是否启用需政策）、母婴、服饰、美容、办公/商业设备、运动户外、收藏/其他。

禁止/限制：武器、毒品、处方药、假货、盗窃物、危险品、成人内容等，正式政策确认。

`LIST-007` 已落地 Secondhand v1：价格只允许 FIXED/NEGOTIABLE/FREE；`condition` 与非空
`deliveryOptions` 必填，品牌/型号可选。`marketplacePolicyAcknowledged` 必须明确为 true 且为
OWNER_ONLY。v3 高置信禁售品规则只把字段名送高优先人工审核，不复制疑似原文，也不代替正式政策、
人工判断或执法结论。

### 服务

装修、水电、空调、屋顶、园艺、搬家、清洁、汽车、家政、摄影、会计税务、法律/移民（资质严格）、保险/地产（执照）、教育、IT、餐饮活动、其他。

关键字段：service area/radius、执照/保险、经验、报价单位、紧急服务、可用时间。受监管职业必须验证或明确“未验证”。

`LIST-007` 已落地 Service v1：价格只允许 HOURLY/FIXED/NEGOTIABLE；`serviceRadiusMiles` 限制
1–100，`licenseStatus`、非空 `availability` 和 `servicePolicyAcknowledged` 必填，保险和紧急服务
可选。`licenseNumber` 与政策确认属于 OWNER_ONLY；公开的执照/保险状态必须继续标为发布者声明，
不能呈现为平台核验。

## 23.3 地区层级

Seed 已提供南加州常用城市。正式数据建议：

```text
US
└── California
    ├── Los Angeles County
    │   ├── Los Angeles
    │   ├── Monterey Park
    │   ├── Alhambra
    │   ├── Arcadia
    │   ├── San Gabriel
    │   ├── City of Industry
    │   ├── Walnut
    │   └── Long Beach ...
    └── Orange County
        ├── Irvine
        ├── Anaheim
        ├── Costa Mesa
        └── ...
```

城市别名（洛杉矶/LA、蒙市/MPK、尔湾/Irvine）存入 alias 表/搜索词典，不作为重复 Region。

`TAX-001` 将此原则落为 `region_aliases` / `category_aliases`：原始别名保留 locale 与显示值，
另存 NFKC、大小写和常见分隔符归一化键用于参数化查询。别名表通过 FK 依附稳定 taxonomy ID，
删除父节点时级联清理；同一父节点、locale、归一化键唯一。公开 API 只返回 active 主数据、原始
别名和中英名称，不返回内部归一化键，也不允许 `activeOnly=false` 绕过。无筛选时返回树；
`parentCode` / `parentId` 返回直接子级，type/vertical 或 `q` 查询返回扁平匹配节点。

## 23.4 动态表单版本

`schemas/listing-form.schema.json` 定义表单配置 envelope。每次发布 schema 形成不可变版本：

- 字段 key 和类型一旦有数据不可随意改变。
- required 的新增需考虑旧草稿/已发布内容。
- UI component 只允许系统白名单。
- 条件逻辑采用受控表达式，不执行任意 JavaScript。
- 服务端根据保存时 schema/version 验证；前端 schema 只是体验增强。
- 搜索可筛选字段必须有规范化映射，不从自由 JSON 临时推断。

`TAX-002` 将上述约束落为 `category_form_schema_versions`。每个 Category 最多有一个未发布
draft；draft 用 `revision` 做乐观并发，发布前再次核对 Category 当前版本。发布在同一事务内写入
`publishedAt/publishedById`、推进 `categories.form_schema_version`，并重建受控的
`category_fields` 投影。数据库触发器禁止更新或删除已发布记录；回滚复制目标历史定义并发布为新的
单调递增版本，`basedOnVersion` 保存来源，绝不把当前指针倒退或覆盖历史。

每条 Listing 保存 `form_schema_version`。服务端校验草稿时读取该 Category 的精确已发布版本，
因此 version 2 新增 required 字段不会让 version 1 草稿失效。公开
`GET /categories/{categoryId}/form-schema` 默认返回当前已发布版本，也可用正整数 `version`
读取历史已发布版本；draft、停用 Category 和未知版本统一不可见。当前版本短缓存，显式历史版本使用
immutable cache，并以 SHA-256 内容哈希作为强 ETag。

表单字段和选项均有数量/长度上限，key/option value 唯一。SELECT/MULTISELECT 必须来自显式
option；可筛选类型进入白名单。PHONE/EMAIL 必须是非公开、不可搜索/筛选字段。pattern 禁止回溯引用、
lookaround 和嵌套量词等高风险构造，不接受脚本或任意 UI component。管理端 draft/preview/publish/
rollback HTTP adapter 必须等 `ADMIN-001` 的 SSO/MFA/RBAC shell 完成后接入；本切片已提供可复用的
应用服务和原子 Repository，不会先暴露匿名管理写口。

## 23.5 分类变更治理

Draft → Review → Preview → Publish → Observe → Rollback。分类合并/移动需：slug redirect、旧 Listing 映射、搜索重建、SEO canonical、报表连续性和推广库存影响评估。

## 23.6 标签与属性

自由标签很容易产生垃圾和同义词碎片。MVP 只允许运营词表和类型化属性；用户可在正文表达其他信息。高频有价值属性经分析后进入 schema，并提供迁移/索引。

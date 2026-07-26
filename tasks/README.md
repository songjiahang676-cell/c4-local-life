# 实施任务包

- `CODEX_PROMPT.md`：可直接粘贴给 Codex 的首次提示词。
- `IMPLEMENTATION_SEQUENCE.md`：Gate 顺序和关键路径。
- `EPICS.md`：能力域总览。
- `BACKLOG.csv`：100 个可执行任务，包含依赖、验收和参考文档。
- `STATUS.md`：项目启动后的状态维护模板。

## 使用方式

1. 从 `BACKLOG.csv` 选择状态为 `todo` 且依赖已完成的最高优先级任务。
2. 把任务 ID 与 references 中的文档一起交给 Codex/工程师。
3. 完成后附实际测试和迁移证据，将状态改为 `done`；阻塞使用 `blocked` 并说明原因。
4. 每个 Gate 退出前按 `docs/22-acceptance-criteria.md` 做正式验收。

状态建议：`todo`、`ready`、`in_progress`、`blocked`、`in_review`、`done`、`cancelled`。不要把“代码写完但未测试”标为 done。

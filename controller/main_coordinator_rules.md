# main_coordinator_rules.md

## talent-policy-repo 主线程协调规则

主线程必须承担协调职责，不只是读摘要。

### 触发介入条件（满足任一条立即介入）
- 15 分钟无新增 commit
- 15 分钟 backlog 的 `done` 不增长
- `controller/deepsearch_state.json` 中 `running` 数量 < 3
- 已识别 rewrite 城市但长时间未处理
- 已完成深挖稿存在但未 commit/push

### 介入动作顺序
1. 先收已完成深挖稿并 commit/push
2. 再优先处理 rewrite 城市（骨架/半成品/缺金额或链接）
3. 再补满 3 并发 deepsearch
4. 子任务完成后立刻收口、更新 backlog、清理 running

### 主线程收到 cron 摘要后必须做的判断
1. 本轮是否有新 commit？
2. backlog done 是否增长？
3. running 是否变化？
4. 若无推进：立即读取 `controller/deepsearch_state.json` 并补位/重跑/收口

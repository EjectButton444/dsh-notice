## Parent

#1

## What to build

宿主半身提供**点击桥**：用户点击通知时，客户端把点击意图送达宿主，宿主执行 `Start-Process 'dsh://open'`，把 DSH 窗口 restore + show + focus（含窗口隐藏到托盘的状态）。任何失败静默处理，不影响会话与通知主流程。

通道沿用 spec 的免构建方案（宿主 webServer 注册端点 + 客户端 document-relative 请求，与 `dsh-client-hmr` 同款）。点击桥的最终形态以 #3 的基线结论为准；若 #3 判定不可行，按其降级方案实现并在本 issue 记录偏差。

## Acceptance criteria

- [ ] 点击通知能把 DSH 窗口带到前台（窗口在后台时）
- [ ] 窗口隐藏到托盘时，点击通知也能唤起窗口
- [ ] 宿主端点故障时点击静默失败，不影响会话
- [ ] 若采用降级方案，偏差与原因记录在 issue 评论

## Blocked by

- #5

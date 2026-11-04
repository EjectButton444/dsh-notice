Status: done (2026-11-05)

## Parent

#1

## What to build

收尾验收与发布准备：

- 在真机上按 spec 的 7 条验收标准全量验证并修复差距；
- 补齐 README：安装步骤、配置说明、升级后检查清单、已知限制（AUMID/Toast 实测结论与「不需要 PowerShell 降级」结论、点击桥最终形态、精确完成/SSE 语义、锁屏与系统压制限制）；
- 把 AUMID / Toast 的实测结论与降级方案写进文档；
- 清理一次性调试触发等临时代码，跑最终 code review，保持仓库整洁。

## Acceptance criteria

- [x] spec 的 7 条验收标准全部通过，并逐条记录实测结果（见 [spikes/08](../spikes/08-acceptance-release.md)「阶段二」；其中 5 连事件的**通知中心残留**为 Windows 平台已知限制，已记录并进入发布说明，活跃提醒语义符合「每会话单条」）
- [x] README 含安装 / 配置 / 升级检查清单 / 已知限制
- [x] 最终 code review 无阻塞问题（Standards + Spec 两轴；发现项已修复或记录为已知限制）
- [x] 仓库无残留调试代码 / 一次性触发（committed tree 审计 + `npm pack --dry-run` = 11 文件；验收用探针/临时配置已删除并还原 profile）
- [x] 相关 ADR / GLOSSARY 与最终实现一致（ADR-0001 AUMID 实测结论、ADR-0002 v1 宿主范围、GLOSSARY 精确完成/子代理归并）

## 顺延自 #4 / #5 / #7 的真机复核项

- [x] `sound: false` 的实际静音效果：干净构建音频采样 `peak_max=0.0000 nonzero=0`（对照组 sound:true `0.3239`）
- [x] `en` 界面语言文案：切换 English 后通知正文 `Turn completed`（完成；提问/审批文案同源引擎单测覆盖）
- [x] 「DSH 前台但看别的会话时仍弹」：干净构建审批通知用例通过（用户确认 + 通知库）
- [x] 连续事件替换/消解后**通知中心无残留**：#5 修复的同名 tag 缺陷未再出现；5 连事件快速替换后通知中心仍可能残留 1 条旧项（平台 close/replace 竞态，记录为已知限制）
- [x] #7 验收窗口的「同一会话两条提问通知」（en/zh 双实例）：**已定位并修复**（HMR 遗留旧实例；页面级单例锚点 + 回归单测），干净构建复核不再复现
- [x] #7 的页面内 SSE 自动重连：干净页面下宿主重组合后，页面 EventSource 自动重连、完成通知仍送达
- [x] 隐藏/最小化仍提醒 + 点击恢复：干净构建完成通知在托盘隐藏时弹出、点击恢复并切会话
- [ ] 「多待处理时显示另有 N 项」/ 子代理 pending 归并：本 harness 无法构造（子代理会话不能发起人机交互），维持引擎单测 + 代码审查覆盖（沿用 #5 记录）

## 已知限制（发布说明同步）

1. **Windows 通知中心 close/replace 竞态**：同一会话快速连续事件时，活跃 banner 始终只有最新一条，但通知中心偶尔残留旧条目（非 OS 级原子更新）；可手动清除。根治需 OS 级更新或关闭重试策略，建议单独 ticket。
2. **旧通知点击不跳转**：DSH 重启/客户端热重载前创建的通知，其点击处理随旧实例销毁；Windows 仍保留在通知中心，点击只关闭不跳转。正常用法下（未重启且未热重载）通知点击会切回会话并唤起窗口。
3. 锁屏时系统不允许任何程序抢前台；Windows 专注助手/通知设置可压制 Toast。
4. `engines.dsh` 范围外的 DSH 版本会被静默跳过，升级后需按 README「升级后检查清单」自检。

## 记录

- 验收记录：[spikes/08-acceptance-release.md](../spikes/08-acceptance-release.md)（阶段一 + 干净构建阶段二，含证据文件与逐项结论）
- 实现/文档提交见 `git log`；#8 相关提交：`fix: dispose stale browser-half instances after hot reloads (#8)`、`docs: release prep and #8 acceptance stage one (#8)`、本轮验收记录提交。

## Blocked by

- #6（已完成）
- #7（已完成）

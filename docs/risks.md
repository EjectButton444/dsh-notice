# dsh-notice 风险登记表

用于驱动**风险优先的实现顺序**：先做能推翻架构/毁掉可行性的验证（spike），再做依赖它的垂直切片。
评级 = 概率 × 影响；排序：先「能否做成」，再「是否达标」，最后「体验噪音」。

## 风险清单（按优先级）

| # | 风险 | 概率 | 影响 | 最小验证（spike） | 缓解 / 退路 |
|---|---|---|---|---|---|
| R1 | **Windows Toast 归属/图标异常**：Electron 渲染进程的 `new Notification()` 在 Windows 上可能显示为错误归属、无图标或被系统通知设置静默屏蔽（`app.setAppUserModelId` 从未调用） | 中高 | 高：整个渠道可能不可用，ADR-0001 要改 | 最小 client 插件里弹一条 `new Notification()`，检查通知中心归属名、图标、声音、锁屏 | 退路：宿主 `ctx.subprocess` 起 PowerShell/WinRT Toast（需再验 AUMID）；或注册快捷方式 AUMID |
| R2 | **第三方 client 插件加载失败**：`dsh.client` + `exports["./client"]` + `install_bundle` 本地 link 安装后不生效 | 中 | 高：架构得退回宿主侧 | 装一个 hello-world client 插件，确认 `/plugins` 服务、`__ModuleLoader__.load` 执行、HMR 500ms 热替换 | 退路：宿主 Only（放弃前台抑制，回到 ADR 重新决策） |
| R3 | **点击通知无法唤起托盘窗口**：渲染进程内 `dsh://open` 被 `will-navigate` 吞、`window.open` 被拒；只能宿主 `Start-Process 'dsh://open'`，有 1–3s 冷启动，可能丢焦点/双开 | 中 | 中高：验收标准 2 直接相关 | P1 之前先用 PowerShell 手动 `Start-Process 'dsh://open'` 验单实例唤起行为；再验宿主端点 + 点击桥 | **#6 已实现并降级收敛**：宿主端点 + `focus.ps1`，主路径为直接 Win32 消息（`WM_SYSCOMMAND/SC_RESTORE` + `SetForegroundWindow`），`dsh://open` 仅兜底——因实测低完整性宿主下协议第二实例在单实例握手前退出（#3 的 0.16–0.23s 依赖宿主完整性级别）；详见 [docs/spikes/06](spikes/06-click-bridge.md) |
| R4 | **宿主 waterfall 订阅污染审批**：监听器抛错会把审批 fail-closed 成 `unavailable`；不加 `prepend` 会漏事件 | 低 | **极高**：可能让正常审批坏掉（比没有通知更糟） | 单测 + 真实审批触发；代码审查强制 try/catch、只读、`return next()` | 钩子只做「抄一份事件」，任何异常吞掉；不放业务逻辑 |
| R5 | **客户端「完成」近似误报**：客户端只见 `api-session/status(bool)`，Stop/报错/中断都会触发 running→false，分不清 `turn/end.reason` | 高（必然） | 中：通知噪音、语义错误 | P0 实测（手动 Stop 一次看是否误弹）；P1 用宿主 `turn/end.reason.kind` 收敛 | P0 允许近似并在 README 注明；P1 修好 |
| R6 | **DSH 升级导致内部状态/服务变化**：`uiSession.sessionStatus`、`pendingInteraction` 形态随版本变；`engines.dsh` 不匹配时 bundle 被静默跳过 | 中 | 中：插件无声失效 | 记录 DSH 版本，升级后跑真机清单 | 只用文档化服务；`engines.dsh` 锁版本；README 写升级检查步骤 |
| R7 | **隐藏窗口时通知不弹/事件延迟**：Chromium 后台节流可能影响定时器（本设计只用事件不用定时器，但需确认） | 低中 | 中：验收标准 6 | 窗口隐藏到托盘后触发三类事件各一次 | 若定时器被节流：改事件驱动，已在设计中 |
| R8 | **子代理会话误报/漏报**：子代理行被注入 `sessions.byId`，`parentId`/`origin` 判定不准 | 中 | 低中：噪音或漏提醒子代理卡住 | 开一个子代理/团队会话，观察归并与完成是否按预期 | 以 `parentId` 定位主会话；单测覆盖 |
| R9 | **通知合并/消解竞态**：`tag` 替换、`close()` 在 Windows 通知中心的实际行为 | 中 | 低：出现堆叠或残留 | 同一会话 5 连事件 + 处理后观察 | **#5 实测发现并已规避**：通知中心存在同 tag 通知时，新建同 tag 通知会立刻触发 `close` 且后续 `close()` 失效 → 渲染层改用唯一 tag（`${会话tag}#${n}`）+ 显式关闭旧句柄；详见 [docs/spikes/05](spikes/05-notification-rules.md)。仍需 #8 复核连续事件/消解无残留 |
| R10 | **系统环境屏蔽**：Windows 专注助手/通知设置全局压制 Toast | 中 | 中：用户以为插件坏 | 在目标机检查通知设置与专注助手，验收时记录 | 文档说明；检测系统设置不可行则只报错日志 |
| R11 | **隐私**：通知内容暴露会话标题（锁屏/通知中心可见） | 低 | 低：已默认最小内容 | 锁屏状态查看通知 | 内容保持「会话标题+类型」；不显示命令/问题原文 |

## 风险优先的阶段划分

| 阶段 | 目标 | 验证的风险 | 产物 |
|---|---|---|---|
| S0 | 环境就绪：GitHub tracker、gh 登录、DSH plugin 开发环（link 安装 + HMR） | — | `docs/agents/*`、仓库、最小可装插件 |
| S1 | **Spike：最小 client 插件弹一条 Toast** | R1、R2 | 结论（归属/图标/声音是否可接受）+ 决定渠道是否维持 ADR-0001；已完成，见 [spikes/02-toast-spike.md](spikes/02-toast-spike.md) |
| S2 | **Spike：隐藏窗口 + 点击基线** | R3、R7 | 结论（隐藏时是否弹、`dsh://open` 唤起行为）→ 决定 P1 点击桥形态；已完成，见 [spikes/03-tray-click-baseline.md](spikes/03-tray-click-baseline.md) |
| S3 | 客户端垂直切片：注意力检测 + 决策逻辑 + 单测 | R5（接受近似）、R8 | 可运行、可测 |
| S4 | 客户端垂直切片：通知规则（合并/消解/声音/i18n/配置） | R9、R10 | 验收标准 3/4/5 |
| S5 | 宿主半身：精确 `turn/end` + 点击桥 + 安全钩子 | R3、R4、R5 | 验收标准 1/2/6 |
| S6 | 真机验收清单 + 升级兼容说明 | R6、R10、R11 | 全验收通过、README 升级指引 |

**规则**：每个 spike 的结论若推翻某个 ADR，**先改 ADR/更新 spec，再继续排后续 ticket**——不要带着已知错误前提往下做。

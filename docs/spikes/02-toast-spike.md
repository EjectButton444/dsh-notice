# Spike #02：最小客户端插件与 Windows Toast 实测结论

状态：**完成（2026-11-04）**。对应 ticket [02-toast-spike.md](../tickets/02-toast-spike.md)；实现提交 `a5492d2`、`a0aa936`。

本文件是 #2 的一次性真机验证记录，回答两个架构级风险：R2（第三方客户端插件能否安装/激活/加载）与 R1（渲染进程 Web Notification 在 Windows 上的实际表现）。

## 环境

- DSH Desktop **0.2.1-rc.5**，Electron **44.7.0**（Chrome 152），dsh client-modules release `{"version":"0.2.1-rc.5","commit":"d4db512"}`。
- Windows 11 25H2 build **26200.7840**，主屏 2560×1600 @150% 缩放；专注助手/勿扰关闭，系统通知默认开启（相关全局注册表值均未设置）。

## R2：第三方客户端插件的安装、激活、加载 —— 通过（无需重启）

- 安装命令（Desktop 自带 CLI，与 `plugin_manager install_bundle` 共用 `dsh-plugin-manager` 的 package operations）：
  `dsh plugin --profile desktop add "D:\AI区\dsh小插件\notice"`
  - profile `package.json` 写入 `"dsh-notice": "link:D:/AI区/dsh小插件/notice"`，并把 `dsh-notice` 追加到 `dsh.profile.bundles` 末尾；
  - `profiles/desktop/node_modules/dsh-notice` 为指向仓库目录的 junction；
  - 输出无 "declares no dsh.bundle" 警告，bundle patch 通过校验。
- 应用**运行中**安装即生效：HMR 监听 profile manifest 的有序 `bundles` 列表变化并重组合，宿主行即时激活；`GET /plugins/events` 的 client graph 从 75 条变为 76 条，含 `{"id":"dsh-notice","immediately":true,"inject":[]}`。
- 插件列表：Plugins → 已安装 → 「已安装插件」出现卡片（铃铛 icon、标题「DSH 提醒」、描述、整行启用开关）。
- 注意：`dsh plugin` CLI 文档预期先退出应用；运行中安装生效依赖 HMR 的 manifest 观察，属**附带能力**而非 CLI 契约。

## R1：Web Notification 在 Windows 上的表现 —— 可接受，ADR-0001 维持

实测方式：client 半身 `apply` 时一次性 `new Notification('DSH Notice · toast spike', { body, tag: 'dsh-notice-spike', silent: false })`。

| 项 | 结论 |
|---|---|
| 归属名 | Toast 横幅与通知中心均显示 **DeepSeek Harness**。注册表通知项 `electron.app.DeepSeek Harness` 写入 `LastNotificationAddedTime`；WinRT `UserNotificationListener` 读出 `AppUserModelId=electron.app.DeepSeek Harness`、`DisplayName=DeepSeek Harness`。未调用 `app.setAppUserModelId` 也归属正确（安装包 AppUserModelID 生效），因此**不需要**退化为宿主 PowerShell Toast。 |
| 图标 | 横幅左侧显示 DSH 应用图标；未传 `icon` 选项也是应用图标，通知设置按 AUMID 正常归档、可单独开关。 |
| 声音 | **实测有提示音**。CoreAudio `IAudioMeterInformation` 每 ~15ms 采样默认播放设备峰值：基线（无通知 5s）`peak_max=0.0000`；触发 Toast 后 `peak_max=0.3239`，自触发后约 0.8s 起持续约 1.3s 衰减到 0。即 Windows 播放了默认通知音。 |
| 锁屏内容 | **锁屏能弹出通知，但内容被系统隐藏**。用户在锁屏状态下实测：锁屏界面能看到通知与应用归属，正文显示为「私密/隐藏内容」，未泄露标题正文（Windows 锁屏通知隐私开关生效，与隐私设计目标一致）。 |
| 通知中心 / 合并 | WinRT 历史确认进入 Action Center 且可读（title/body/AUMID）。多次触发使用同一 `tag`，历史中该应用只保留**最新一条**——`tag` 原地替换语义在 Windows 可用。 |

## 开发环：~500ms 客户端热替换 —— 通过，且有陷阱

- `dsh-client-hmr` 以 500ms 间隔 stat 轮询已 link 包的 `client.js`；改动后宿主发出 SSE `rebuilt(dsh-notice@<rev>)` 并重发 graph，浏览器重新取 bundle 并重跑 `apply`。
- 实测：保存 `client.js` → 客户端 `apply` 执行 **≈449ms**（11:59:45.790 → 11:59:46.239）；改 `BUILD_TAG` 后通知正文随之变化，可反复验证。
- **陷阱（后续 ticket 必读）**：`client.js` 被宿主以 classic script 拼接加载，HMR 时**重新执行**。顶层写 `const`/`let` 会在第二次执行时抛 "Identifier has already been declared"，表现为「改了没反应」的静默失败。client 插件代码必须整体包在 IIFE/块作用域内（`client.js` 已按此实现并注释）。

## 交付物

- 最小包（仓库根）：`package.json`（`dsh.bundle.patch` + `dsh.client: { platform: web, immediately: true, inject: [] }`）、`cordis.patch.yml`（插入 loader 行 `id: notice` / `name: dsh-notice`）、`index.js`（宿主半身空实现）、`client.js`（一次性调试触发，ticket #8 删除）、`locale/{en,zh}.json`、`icon.svg`。
- 自动测试：`test/plugin-package.test.js`（`node --test`，4 条：manifest/bundle 契约、patch 行、宿主空实现、client load→factory→apply→Notification 契约）。
- 真机证据（截图、通知历史、AUMID 注册表、音频峰值、HMR 帧）为本地临时产物，存放在被 gitignore 的 `.scratch/verify/`，不提交。

## 遗留

- 调试触发保留到 [#08 验收发布](../tickets/08-acceptance-release.md) 清理；期间每次 DSH 客户端加载会弹一条调试 Toast（可在插件页临时关闭该插件）。
- 当前 profile 的 loader 行 id 安装时为 `dsh-notice`，仓库内已按 spec 统一为 `notice`；重启 DSH 后生效，不影响验证结论。

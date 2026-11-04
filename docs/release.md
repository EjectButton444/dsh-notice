# 发布与维护 runbook

面向 `dsh-notice` 维护者的发布流程、DSH 插件市场索引维护与 DSH 升级兼容策略。日常开发环境与真机验证工具见
[docs/dev-loop.md](dev-loop.md)，发布验收清单见 [docs/spikes/08-acceptance-release.md](spikes/08-acceptance-release.md)，
插件市场索引格式与用户侧说明见 [docs/marketplace.md](marketplace.md)。

- npm 包：`dsh-notice`（unscoped，`publishConfig.access = "public"`，MIT）；
- 仓库：<https://github.com/EjectButton444/dsh-notice>（默认分支 `main`）；
- 插件市场索引（固定 raw URL）：<https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json>；
- 版本号遵循 SemVer；`engines.dsh` 是**实测过的** DSH 兼容范围，不是愿望范围。

## 1. 发布前检查

1. **确认功能与真机验证**：本次改动的功能已合入，并按 [spikes/08](spikes/08-acceptance-release.md) 的重跑清单
   在真机上验证相关项（通知是旁路能力，失效通常不报错，必须主动验证）。
2. **改版本号**：编辑 `package.json` 的 `version`（不建议 `npm version`，它会顺手创建 commit / tag）。
3. **写 CHANGELOG**：把 `[Unreleased]` 内容整理为 `## [X.Y.Z] — YYYY-MM-DD`（Keep a Changelog 风格，
   分 Added / Fixed / Security，并保留 Known limitations 一句话）。
4. **全量自检**（在仓库根目录）：

   ```powershell
   node --test --test-isolation=none "test/*.test.js"
   node --check index.js
   node --check client.js
   node --check client.engine.js
   npm.cmd pack --dry-run
   ```

   - 单测应全绿（基线 74+，含 `test/market-index.test.js` 的索引一致性用例）；
   - `npm pack --dry-run` 必须**恰好 11 个文件**：`LICENSE`、`README.md`、`package.json`、`index.js`、
     `client.js`、`client.engine.js`、`focus.ps1`、`cordis.patch.yml`、`icon.svg`、`locale/en.json`、`locale/zh.json`；
     `docs/`、`test/`、`.github/`、`CHANGELOG.md`、`plugin-market-index.json` **不进包**（由 `files` 白名单控制）。
   - 本机注意：PowerShell 执行策略会挡 `npm.ps1`，用 `npm.cmd`；若 npm 缓存目录不可写（沙箱 / 权限），
     dry-run 加 `--cache .scratch\npm-cache`（`.scratch/` 已 gitignore）。
5. **提交并 push `main`**：push 后 GitHub Actions（[ci.yml](../.github/workflows/ci.yml)）会跑语法检查、全量单测与
   `npm pack --dry-run`；确认 CI 绿再发布。
6. 确认版本三处待同步（package.json / CHANGELOG / 插件索引）；索引在 npm 发布**之后**更新（见第 4 节）。

## 2. npm 发布

发布由维护者在本机执行，不走 CI（CI 不持有 npm token；2FA 也不适合放进自动化）。

1. 确认 registry 与登录状态：

   ```powershell
   npm.cmd config get registry    # https://registry.npmjs.org/
   npm.cmd whoami
   ```

2. 确认目标版本不存在（首发时包名应未占用）：

   ```powershell
   npm.cmd view dsh-notice version
   ```

3. 发布（在仓库根目录）：

   ```powershell
   npm.cmd publish
   ```

   - 账号开启 2FA 时按提示输入 authenticator 一次性密码（或 `--otp=<code>`）；
   - `publishConfig.access = "public"` 已声明，**不需要**再传 `--access public`；
   - `package.json` 不得有 `private`（缺省即 public 包）；发布前若报 `EPRIVATE`，检查该字段；
   - `npm publish` 会重新打包并跑 `prepublishOnly`（本仓库没有该脚本）。

4. 验证发布结果：

   ```powershell
   npm.cmd view dsh-notice version
   npm.cmd view dsh-notice dist.tarball
   npm.cmd view dsh-notice engines.dsh
   npm.cmd view dsh-notice time.X.Y.Z
   ```

   期望：`version` = 新版本、`engines.dsh` = `package.json` 中的范围、`time.X.Y.Z` 为实际发布时间（记下来，
   下一步写进索引的 `publishTimestamp`）。

> 已发布版本**不能覆盖或删除**（npm 只允许 `npm deprecate`）。因此第 1 步的 `npm pack --dry-run` 必须逐项确认；
> 发布后发现内容有误只能发新 patch，并 deprecate 问题版本（见第 8 节回滚）。

## 3. GitHub tag 与 Release

1. 打 tag 并 push（tag 名 = `v` + `package.json` 版本）：

   ```powershell
   git tag -a vX.Y.Z -m "dsh-notice vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

2. 创建 GitHub Release（网页或 `gh release create vX.Y.Z --title "dsh-notice vX.Y.Z" --notes-file <notes.md>`）。
   Release 说明必须包含：
   - **安装**：插件市场索引 URL（Discover → Add index source）、npm spec（`dsh-notice@X.Y.Z`）、CLI 命令
     `dsh plugin --profile desktop add dsh-notice@X.Y.Z`；
   - **兼容范围**：Windows 桌面版 DSH，`engines.dsh` 原文；
   - **已知限制**链接（README「已知限制」）与 CHANGELOG 链接；
   - 首次发布（v1.0.0）额外说明：插件市场索引机制是**第三方自定义索引**，安装前确认信任。

## 4. 更新 DSH 插件市场索引

索引文件与校验脚本：`plugin-market-index.json`、`scripts/validate-market-index.mjs`、
`test/market-index.test.js`；格式说明与用户步骤见 [docs/marketplace.md](marketplace.md)。

1. 在 `plugins` 中 `name: "dsh-notice"` 的 `versions` 数组**最前面**插入一条新版本（数组保持版本降序、版本唯一）：

   ```json
   {
     "version": "X.Y.Z",
     "publishTimestamp": 1793818801,
     "source": { "type": "npm" },
     "engines": { "dsh": ">=0.2.1-rc.5 <0.3.0" }
   }
   ```

   - `publishTimestamp`：Unix **秒**整数，取第 2 步 `npm view dsh-notice time.X.Y.Z` 的实际发布时间
     （或发布后 `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`），范围 `[0, 1e11)`；
   - `engines.dsh` 必须与 `package.json` **完全一致**（校验脚本交叉检查）；兼容范围变更时两处同步改；
   - `source.type` 为 `"npm"` 时使用默认 npm registry（本包不指定 `registry`）。

2. 本地校验：

   ```powershell
   node scripts/validate-market-index.mjs
   node --test --test-isolation=none test/market-index.test.js
   ```

3. 提交并 push `main`。索引 URL 固定为 `main` 分支的 raw 地址，**不要改 URL**（用户已添加的索引源不会自动迁移）。

4. 生效与缓存：DSH 读取索引有约 10 分钟缓存（`plugin-market` 的 `cacheTtlMs`），GitHub raw 也可能有缓存。
   发布后在 Discover 里刷新（或重启 DSH）确认能看到新版本；发布窗口内旧索引仍可用，属正常现象。

## 5. 发布后在 DSH 里验证 Discover 安装

1. Plugins → **Discover** → **Add index source** → 粘贴索引 URL；应显示索引标题与描述（而非读取错误）；
2. 搜索 `dsh-notice`，打开条目：版本、作者、发布时间、兼容性（compatible）正确；
3. **Install** → 确认框 exact spec 应为 `dsh-notice@X.Y.Z`、registry 为 npm 官方 → 安装后插件页出现
   「DSH 提醒」（`dsh-notice`）卡片，默认启用；
4. 抽查行为：三类事件各触发一次通知、点击通知切回事件会话并唤起窗口（详细清单见「升级后检查清单」）；
5. 若条目显示「没有兼容版本 / 禁用 Install」：检查本机 DSH 版本是否落在 `engines.dsh` 内。落在范围外时这是
   **预期行为**（索引按宿主版本禁用安装），需要新版 DSH 适配或插件新版本，不要引导用户用版本豁免绕过。

## 6. DSH 升级兼容策略

前提：DSH 是快速迭代的宿主，**DSH 版本变化导致本插件失效属正常情况**，不算插件 bug。维护承诺是：每个 DSH
新 rc / minor（尤其 Electron 大版本变化）发布后，按下述流程重跑真机清单并发布适配版本。

触发条件：DSH Desktop 发布新版本（rc / minor / 大版本），或用户报告「插件页没有 dsh-notice 行 / 通知不再出现」。

步骤：

1. 在新 DSH 上安装当前发布版本，先看是否被**静默跳过**（`engines.dsh` 不匹配时表现为插件页没有这一行、
   也不报错）；
2. 按 [spikes/08](spikes/08-acceptance-release.md) 的清单重跑真机验收；重点复核两处 DSH 内部契约：
   - 点击桥依赖的 **Electron 托盘消息契约**（`Electron_NotifyIconHostWindow` / `WM_APP+1` / icon id 2 /
     `WM_LBUTTONDOWN`）见 [spikes/06](spikes/06-click-bridge.md)；
   - 精确完成依赖的 **`session/event` 的 `turn/end` 载荷**（只有 `reason.kind === 'completed'` 才提醒）
     与 `dsh-app://` 同源转发，见 [spikes/07](spikes/07-precise-turn-completion.md)；
3. 需要放宽/收紧 `engines.dsh` 时：**先验证、后声明**。只在实测通过的宿主范围内声明支持；未实测的版本不要写进
   范围（宁可不匹配、让用户明确看到不支持，也不要让用户以为已适配）；
4. 同步 `package.json` 的 `engines.dsh` 与 `plugin-market-index.json` 对应版本的 `engines`；
5. 重跑全量单测与 `npm pack --dry-run`，更新 CHANGELOG，按第 2–5 节发布 patch/minor（不能原地覆盖旧版本）；
6. 临时手段：用户可自行用版本豁免（`dsh plugin --profile desktop version-exemptions` /
   `allow-version <package@version> --dsh-version <runtime> --accept-risk`）精确放行，但风险自担；README 与
   Release 不默认推荐该做法；
7. 若新 DSH 完全无法适配：在 README / Release 明确标注不支持范围，`npm deprecate` 受影响版本，并尽快发布适配版。

## 7. 发布后检查清单

- [ ] `npm view dsh-notice version` = 新版本；包内容含宿主/客户端两半身、`cordis.patch.yml`、`focus.ps1`、locale、icon；
- [ ] GitHub `main` 与本地一致，tag `vX.Y.Z` 存在，Release 含安装 / 兼容 / 已知限制；
- [ ] `plugin-market-index.json` 通过 `scripts/validate-market-index.mjs` 与 `test/market-index.test.js`，
      且与 npm 包元数据（name / version / engines.dsh）一致；
- [ ] 本机 DSH Discover 添加索引 URL 后能看到 `dsh-notice` 并安装成功（用户确认）；
- [ ] CI（push）通过；README / CHANGELOG / 本 runbook 已同步；
- [ ] 把本版本的发布记录（时间、tag、索引版本条目）补进 [docs/tickets/10-public-release.md](tickets/10-public-release.md) 的「记录」一节。

## 8. 回滚与故障处理

- **npm 版本不可撤回**：用 `npm deprecate` 标记问题版本并引导升级：

  ```powershell
  npm.cmd deprecate "dsh-notice@X.Y.Z" "该版本存在问题：<原因>，请升级到 X.Y.(Z+1)"
  ```

  然后尽快发布修复版本（patch）。不要尝试 `npm unpublish`（受策略限制，且会破坏已安装用户的可重复安装）。
- **GitHub Release**：在 Release 说明里标注该版本已撤回（retracted）并链接修复版本；tag 保留（删除 tag 会破坏
  可重复性/缓存引用），必要时用 `gh release edit` 更新说明。
- **插件市场索引**：从 `versions` 中移除问题版本（或修正其 `engines` / 元数据），校验后 push；已安装用户不受索引
  影响，需要按 README 更新/卸载说明处理。
- **用户侧恢复**：插件页 Remove 后重装；或退出 DSH 后 `dsh plugin --profile desktop add dsh-notice@<可用版本>`。
- **索引读取失败排查**：DSH Discover 的 **Index sources** 对话框会显示最近一次读取错误（网络 / 非 https / 重复 URL /
  格式校验失败 JSON 路径）；先跑 `node scripts/validate-market-index.mjs` 排除格式问题，再查网络与 GitHub raw 可访问性。

## 参考

- 插件市场（格式、用户步骤、索引维护）：[docs/marketplace.md](marketplace.md)、[plugin-market-index.json](../plugin-market-index.json)、
  [scripts/validate-market-index.mjs](../scripts/validate-market-index.mjs)、[test/market-index.test.js](../test/market-index.test.js)
- 发布验收：[docs/spikes/08-acceptance-release.md](spikes/08-acceptance-release.md)；真机开发环：[docs/dev-loop.md](dev-loop.md)
- 变更记录：[CHANGELOG.md](../CHANGELOG.md)；工单：[docs/tickets/10-public-release.md](tickets/10-public-release.md)
- CI：[.github/workflows/ci.yml](../.github/workflows/ci.yml)

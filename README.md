# dsh-notice：仿codex的dsh消息提示插件

> *『不愿意太冒险给agent开完全权限，但总因权限批准卡住影响工作效率？』*

> *『常常因为将dsh且到后台而没注意到它的提问与执行结束？』*

> *『喜欢codex风的消息提示体验？』*

那么就来试试dsh-notice插件吧！

## 功能

- **完全的仿codex设计**：dsh-notice将会在agent请求**授权**、向你**提问**、以及**执行完成**时发送简洁的系统提示并同时伴随“叮~”的一声，此时只需要点击弹窗就可以回到工作session了。
- **更加智能可控的触发设计**：如同codex一般，这个弹窗仅会在你未聚焦session时弹出，同时新增了防堆叠功能以防被多个session完成消息轰炸，以及你可以自由的设置它的静默与否，便捷可靠

## 效果展示

同一个事件在通知里长这样（标题 = 会话标题，正文 = 事件类型）：

![完成通知：测试回复 / 本轮已完成](https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/docs/assets/notification-complete.png)

![提问通知：测试回复 / 在等你回答](https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/docs/assets/notification-question.png)

![权限通知：测试回复 / 需要你确认权限](https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/docs/assets/notification-approval.png)

不同处境下，它这样表现：

| 你的处境 | dsh-notice 的行为 |
|---|---|
| 在别的应用里忙，代理请求工具权限 | 弹「需要你确认权限」；点击通知 → 回到会话并看到审批弹窗 |
| 代理向你提问，你不在 DSH | 弹「在等你回答」；点击通知 → 回到会话直接回答 |
| 长任务跑完，你已经在看别的东西 | 弹「本轮已完成」；点击通知 → 回到该会话继续下一条指令 |
| DSH 在前台，但主视图是另一个会话 | 出事会话**仍然提醒**；点击通知自动切过去 |
| 你正看着这条会话 | 不打扰（默认 `unfocused` 条件） |
| 你按了 Stop 停掉本轮 | **不弹**「本轮已完成」 |
| 同一个会话短时间连续多个事件 | 只保留一条通知并原地更新，不堆叠轰炸 |
| 你处理完审批/回答完问题 | 对应通知自动关闭 |

## 安装

v1.0.0 起通过 npm 包 `dsh-notice` 与 DSH 插件市场分发。安装后宿主半身与客户端半身一起装入，**Plugins → 已安装插件**中出现「DSH 提醒」（`dsh-notice`）卡片，默认启用。

### 环境要求

- 仅 **Windows 桌面版 DSH**；实测基线 **DSH Desktop 0.2.1-rc.5 / Electron 44.7.0**；
- 插件声明 `engines.dsh: ">=0.2.1-rc.5 <0.3.0"`；版本不匹配时 DSH 会**静默跳过**本插件（不报错、也不加载）；
- 需要 DSH 桌面版初始化过的 `desktop` profile（首次打开 DSH 即已初始化）。

### 方式一：DSH 插件市场（推荐）

DSH 的「插件市场」不是中心化商店，而是用户自行添加的**自定义插件索引**。本仓库维护一个 format-1 索引：

1. 打开 DSH → **Plugins** → **Discover** 标签；
2. 点 **Add index source**，粘贴索引 URL：

   ```text
   https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json
   ```

3. 在 Discover 中搜索 `dsh-notice`（标题「DSH 提醒」），打开条目 → **Install**；
4. 确认框会显示精确安装 spec `dsh-notice@1.0.0`、来源与兼容性；勾选信任提示后确认安装。

> 索引内容与包由第三方（本仓库）提供，不在 DSH 官方审核范围内；DSH 会在添加索引源与安装时提示信任，请只添加你信任的索引。索引读取失败时，可在 **Index sources** 对话框里看到具体原因。若 DSH 版本超出插件的 `engines.dsh` 范围，Discover 会禁用 Install（提示没有兼容版本）——这属于宿主版本不匹配，升级 DSH 或等待插件适配。

### 方式二：插件管理器（直接填 npm 包名）

1. **Plugins** → **Add plugin** → 选 **安装第三方插件**（Install a third-party plugin）；
2. 包名一栏填 `dsh-notice@1.0.0`（固定版本；只填 `dsh-notice` 则取最新版）；
3. **Registry** 保持默认（pnpm 配置的 registry，通常为 npm 官方），勾选信任（trust）→ **Install**；
4. 安装完成后可 **Enable now** 立即启用，或稍后在已安装插件列表里启用。

### 方式三：命令行（npm 包）

1. **完全退出 DSH**（`dsh plugin --profile desktop` 要求 desktop profile 已初始化、且应用未运行）；
2. 运行：

   ```powershell
   dsh plugin --profile desktop add dsh-notice@1.0.0
   ```

   该命令把包管理参数转发给 profile 目录里的 pnpm（等价于在该 profile 内 `pnpm add dsh-notice@1.0.0`），并把新 bundle 追加到 profile 的 `dsh.profile.bundles`；宿主半身与客户端半身一起安装；
3. 启动 DSH，Plugins → 已安装插件中出现「DSH 提醒」（`dsh-notice`）卡片。

### 方式四：开发者本地目录（link）

本地开发 / 调试仍可安装工作区目录（`link:` 依赖），改动可被 HMR 热替换：

1. 退出 DSH（应用运行中安装也能生效，但那是 HMR 的附带能力，不是 CLI 契约）；
2. 运行（把路径换成**本仓库的绝对路径**）：

   ```powershell
   dsh plugin --profile desktop add "D:\AIcode\dsh-notice"
   ```

3. 启动 DSH，Plugins → 已安装插件中出现「DSH 提醒」（`dsh-notice`）卡片，默认启用。

### 禁用 / 卸载

- 禁用：Plugins 插件页里本插件行的启用开关（相当于禁用该 loader 行）；
- 卸载：插件页 Remove，或运行 `dsh plugin --profile desktop remove dsh-notice`（改 profile；CLI 预期应用未运行）；
- 若曾在 profile 的 `cordis.patch.yml` 里写过本插件的配置覆盖，卸载后可删除对应的 `- id: notice` 块（见下方「配置」）。

## 使用方法

安装完基本什么都不用做：**离开 DSH 就行**。

- 通知弹出时：**点一下** = 回到事件所属会话 + 唤起窗口；不点就留在通知中心，处理完会自动消失。
- DSH 默认关闭窗口是**隐藏到托盘**（不是退出）；隐藏期间插件照常工作。完全退出 DSH 后不再有提醒。
- 你按 **Stop**、本轮报错、中断、fork、token 上限——都不会收到「本轮已完成」。
- 三类事件默认全开；想分别关闭、改成「总是提醒」、静音或关掉提示音，见下方「配置」。
- 升级到新版本、DSH 升级后如何自检，见「版本与更新」与「升级后检查清单」。

## 配置

配置位于 DSH profile 的 `cordis.patch.yml` 中本插件的 loader 行。desktop profile 的 patch 文件一般形如 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`（以你机器上的 profile 路径为准）。

**行 id 必须是 `notice`**（bundle 插入的行 id），在 profile 的 `cordis.patch.yml` 中追加/修改本插件覆盖块：

```yaml
- id: notice
  name: dsh-notice
  config:
    events: { approval: true, question: true, turnComplete: true }
    condition: unfocused   # unfocused | always
    sound: true
    mute: false
```

| 键 | 默认值 | 说明 |
|---|---|---|
| `events.approval` | `true` | 授权请求提醒开关 |
| `events.question` | `true` | 提问请求提醒开关 |
| `events.turnComplete` | `true` | 回合完成提醒开关 |
| `condition` | `unfocused` | `unfocused` = 只在没看 DSH、或在看别的会话时提醒；`always` = 总是提醒 |
| `sound` | `true` | 是否带系统提示音 |
| `mute` | `false` | 全局静音；`true` 时一条通知都不发 |

- **整体替换，不深合并**：profile 里的 `config` 块会整体替换本插件该行的配置，缺失键回退默认值；**建议每次重述整块所有键**。
- **生效路径**：保存 profile patch 后，开发环里约 1.7–2.1s 完成宿主活重组合，但客户端半身不会自动重新读取配置；正式使用以**修改后重启 DSH** 为准。
- **没有设置界面**：v1 配置只走文件；宿主以只读路由 `GET /dsh-notice/config` 暴露配置原文，校验与默认值由纯决策引擎 `normalizeConfig` 承担（单测覆盖）。

## 版本与更新

当前版本 **v1.0.0**（见 [CHANGELOG.md](CHANGELOG.md)、[GitHub Releases](https://github.com/EjectButton444/dsh-notice/releases)）。

- **升级到新版本**：DSH 目前不提供一键升级——插件市场对已安装插件只显示「Update available」状态，插件页也没有 Update 动作（官方内置插件除外）。升级 = **先卸载旧版本，再安装新版本**：
  - 市场 / 插件页安装的：在已安装插件里 Remove 后，回到 Discover（或 Add plugin）安装新版本；
  - CLI 安装的（推荐，会保留 bundle 的启用选择）：退出 DSH 后运行 `dsh plugin --profile desktop add dsh-notice@<新版本>`，再启动 DSH；
- **升级后确认**：Plugins 页中的版本号应为新版本；按下方「升级后检查清单」抽查三类事件与点击通知；
- **DSH 升级后**：本插件只支持 `engines.dsh` 声明的 DSH 范围，不匹配会被**静默跳过**（不报错）。DSH 大版本 / 新 rc 发布后，请按「升级后检查清单」自检；维护者会重跑真机清单、同步 `package.json` 与插件市场索引里的 `engines.dsh` 后发布新版本。
- **本地开发（`link:`）安装的更新**：`git pull` 后客户端半身由 HMR 约 450ms 热替换；宿主半身（`index.js` / `cordis.patch.yml`）需要一次 profile 重组合或重启 DSH 才加载新代码。详见 [docs/dev-loop.md](docs/dev-loop.md)。

## 升级后检查清单

DSH 升级（尤其是 DSH / Electron 大版本）后逐项自检。通知是旁路能力，失效时通常**不报错、只表现为「通知不再出现」**，所以升级后建议主动跑一遍：

1. **版本匹配**：新 DSH 版本是否仍落在 `engines.dsh` 范围（`>=0.2.1-rc.5 <0.3.0`）内。不匹配会被**静默跳过**——表现为插件页没有这一行、也不报错；需要放宽范围并重新验证后再使用。
2. **插件加载**：Plugins 插件页能看到 `dsh-notice` 行且处于启用状态；client graph（`GET /plugins/events`）里出现 `dsh-notice`（也可以直接看三类通知是否还会弹）。
3. **宿主路由**：访问 `http://127.0.0.1:<port>/dsh-notice/config` 应返回 200（端口以 DSH 实际监听为准，每次启动可能不同；无覆盖时响应 `{}`）；`curl -I http://127.0.0.1:<port>/dsh-notice/events` 应返回 200（说明精确完成的 SSE 路由已挂载）。
4. **三类事件各触发一次**：切到其他应用后，分别制造授权、提问、回合完成，各应收到一条通知；用户按 Stop 不应弹「本轮已完成」。
5. **点击通知**：点击后 DSH 窗口回到前台且可正常操作（托盘隐藏 / 最小化 / 后台三种状态）；还应先切到事件所属会话。
6. **依赖契约变化点**：点击桥依赖 **Electron 44.7.0 的托盘消息契约**（[spike 06](docs/spikes/06-click-bridge.md)）；精确回合完成依赖 **`session/event` 的 `turn/end` 载荷**与 `dsh-app://` 同源转发（[spike 07](docs/spikes/07-precise-turn-completion.md)）——这两处是 DSH 升级后最需要复核的点。
7. **系统侧检查**：Windows 专注助手/勿扰是否开启、系统通知总开关与「DeepSeek Harness」的应用通知设置是否被关掉。

## 目录结构

| 路径 | 作用 |
|---|---|
| `index.js` | 宿主半身（ESM）：只读配置路由、点击桥、精确完成 SSE 下发 |
| `client.js` | 浏览器半身（适配层）：订阅 DSH 状态、发出系统通知、处理点击 |
| `client.engine.js` | 纯决策引擎（package-local client chunk）：映射/抑制/合并/消解/文案，唯一自动化 seam |
| `focus.ps1` | 点击通知后的窗口恢复 helper（Electron 托盘原生恢复 → Win32 → `dsh://open` 兜底） |
| `cordis.patch.yml` | bundle patch：插入 loader 行 `notice` |
| `locale/` | 插件页中英文标题/描述 |
| `plugin-market-index.json` | DSH 插件市场索引（format 1，npm 源） |
| `test/` | `node --test` 单测（引擎 / 宿主 SSE / 客户端接驳 / 打包与索引契约） |
| `docs/` | 规格、工单、spike 真机记录、ADR、发布与市场索引维护 |
| `.github/workflows/ci.yml` | CI：语法检查 + 全量单测 + `npm pack --dry-run` |

## 后言

如果你用它少漏了几次审批、少空等了几轮长任务，欢迎给个 ⭐；有更好的想法或 bug，直接开 [Issue](https://github.com/EjectButton444/dsh-notice/issues) 告诉我。DSH 迭代很快，插件会跟着持续更新；发布与兼容维护方式见 [docs/release.md](docs/release.md)。

## 许可证

[MIT](LICENSE)

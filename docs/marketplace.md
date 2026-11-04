# 插件市场索引（plugin-market-index.json）

本仓库随源码发布一份 DSH **插件市场索引**（DSH plugin market index），让用户不必克隆仓库，就能在 DSH 的 **Plugins → Discover** 里搜索并安装 `dsh-notice`。

- 索引文件：[`plugin-market-index.json`](../plugin-market-index.json)
- 格式规范：DSH 的 `@deepseek-ai/dsh-plugin-market-index`（format 1）；发版流程：[`docs/release.md`](./release.md)
- 本地校验：`node scripts/validate-market-index.mjs`

> 市场文本属于**第三方内容**。索引由用户手动添加，DSH 不会自动信任其中的条目；安装即执行第三方代码，请只添加你信任的来源。

## 它是什么

DSH 的插件市场**不是**中心化注册表，而是一组「自定义索引源」：每个索引就是一个 JSON 文件（format 1），列出可安装的插件、展示信息和每个版本对应的安装参数（npm 包版本或 git commit）。用户把索引 URL 加进 Discover 后，DSH 负责拉取、校验、展示并安装条目。

本仓库索引对外提供的信息：

| 字段 | 值 |
| --- | --- |
| 索引地址（规范源） | `https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json` |
| 分支要求 | `main`（URL 里写死，分支改名会让旧 URL 失效） |
| 插件条目 | `dsh-notice`，分类 `notifications` |
| 版本来源 | npm（`source.type: "npm"` → 安装目标 `dsh-notice@<version>`） |
| 兼容范围 | `engines.dsh: ">=0.2.1-rc.5 <0.3.0"` |

## 用户：添加索引并安装

1. 打开 DSH 桌面版，进入 **Plugins（插件）** 页，切到 **Discover（发现）** 标签；
2. 首次使用没有索引源，点空状态里的 **Add index source（添加索引源）**；
3. 粘贴上面的 raw 索引 URL，确认。DSH 会校验 URL（必须是 https、不带账号密码、不带 query/fragment）并读取索引；
4. 索引出现后，用搜索框输入 `dsh-notice`，或选分类 **通知（Notifications）** 找到插件；
5. 打开条目，选版本（当前 `1.0.0`）→ **Install**，按提示确认安装第三方插件；
6. 回到 **Installed（已安装）**，应出现「DSH 提醒」行且默认启用（卸载/禁用也在该行操作）。

索引源可在 Discover 的工具菜单 → **Manage index sources（管理索引源）** 中刷新、切换或删除；某个源读取失败时，该源的错误会显示在 Index sources 里，索引列表保留上次成功的结果。

> 本地目录 / 开发方式安装（`link:`、HMR）见 [README 的安装章节](../README.md#安装)，与本索引互不影响。

## 维护者：每次发版如何更新索引

索引是**发布产物**，必须与 `package.json` 和 npm 上的真实版本一致；`scripts/validate-market-index.mjs` 会交叉检查两者。发版时按顺序：

1. **改版本**：在 `package.json` 里 bump `version`；若 DSH 兼容范围变化，同步改 `engines.dsh`（完整发版流程见 [docs/release.md](./release.md)）；
2. **发布 npm 包**：`npm publish`（首次发布前确认 `private` 已移除、`npm view dsh-notice@<version> version` 能查到）；
3. **取发布时间戳**：`publishTimestamp` 是 **Unix 秒（整数）**，不是毫秒，也不是 ISO 字符串。取 npm 上的实际发布时间：
   ```powershell
   npm view dsh-notice time.1.0.0
   [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
   ```
   也可以从 ISO 时间换算：`node -e "console.log(Date.parse('2026-11-05T03:00:00+08:00') / 1000)"` → `1793818800`；
4. **在索引里加版本**：编辑 `plugin-market-index.json` 的 `plugins[0].versions`，**把新版本放在数组最前面**（versions 必须按 SemVer 从高到低排列，唯一、非空）：
   ```json
   {
     "version": "1.0.0",
     "publishTimestamp": 1793818800,
     "source": { "type": "npm" },
     "engines": { "dsh": ">=0.2.1-rc.5 <0.3.0" }
   }
   ```
   `engines.dsh` 必须与 `package.json` 的 `engines.dsh` **逐字一致**（校验脚本会比对）；旧的版本条目保留，方便用户降级安装；
5. **本地校验**：
   ```powershell
   node scripts/validate-market-index.mjs
   node --test --test-isolation=none test/market-index.test.js
   ```
6. **提交并推送 main**：索引通过 raw URL 提供，push 到 `main` 后即生效（GitHub raw 可能有几分钟 CDN 缓存）；需要的话再打 tag / 建 GitHub Release。

几个约束（都写在校验脚本里）：

- 索引根：`format: 1`，`title`、`description` 均必填（本仓库要求）；`title`/`description` 是**本地化文本**——格式允许非空字符串，或按小写语言 id 分键的对象，且必须含 `en`；本仓库要求用对象并同时提供 `en` + `zh`（分类等声明里的标题同样如此）；
- 插件名必须是合法 npm 包名；`homepage`、`repository.url` 必须是**绝对 https** URL；
- 每个版本必须有精确 SemVer 的 `version`、整数 Unix 秒 `publishTimestamp`、`source`（本插件用 npm）；
- 分类 id 必须先在 `metadata.categories` 里声明；本索引声明了 `notifications` 分类。

## 为什么图标是内联的（inline data URI）

`plugins[0].icon` 直接内联 `icon.svg` 的 base64（`data:image/svg+xml;base64,...`，解码后 346 字节，远低于 32 KiB 上限）：

- **隐私**：远程图标 URL 会让每个浏览索引的用户额外请求第三方图片地址，暴露 IP / 网络信息；内联图标不发任何额外请求（DSH 对远程图标也只加 `referrerpolicy="no-referrer"`）；
- **稳定**：不依赖图床或 CDN，索引单文件自包含；
- **维护**：图标唯一来源是仓库根目录的 `icon.svg`。改图标后重新生成 base64 并替换该字段，校验脚本会比对解码内容与该文件是否一致：
  ```powershell
  node -e "const b=require('fs').readFileSync('icon.svg'); console.log('data:image/svg+xml;base64,'+b.toString('base64'))"
  ```
  格式限制：仅 `svg`/`png`/`jpeg`/`webp`，解码后 ≤ 32 KiB；本仓库策略只接受内联 SVG。

## 排查

**索引读取失败**（Discover 的 Index sources 里显示错误）：

- URL 必须是 `https://` 绝对地址，不能带 query、fragment 或账号密码；
- 确认文件已 push 到 `main` 且路径是仓库根的 `plugin-market-index.json`：用浏览器直接打开 raw URL 应看到 JSON 文本；
- JSON 语法错误、`format` 不是 1、缺少 `en` 本地化、versions 为空/重复/未降序、图标超 32 KiB 等都会让 DSH 拒读——本地先跑 `node scripts/validate-market-index.mjs`，它的报错带 JSON 路径；
- 刚 push 后仍有旧内容：DSH 读取索引有约 10 分钟缓存（`plugin-market` 的 `cacheTtlMs`），GitHub raw 也可能有缓存；在 Discover 里刷新（或重启 DSH / 重新添加索引源）确认。

**条目显示不兼容、Install 被禁用**：条目的 `engines.dsh` 是对 DSH 版本声明的 SemVer range。本机 DSH 版本不在范围内时，Discover 会禁用该版本的 Install（提示没有兼容版本），已安装的旧版本也可能被宿主静默跳过加载。这属于**有意的兼容性声明**：不要为了装上而放宽 range，应先在对应 DSH 版本上真机验证，再同时更新 `package.json` 和索引里的 `engines.dsh`，走一次新的 patch 版本发布。

**图标不显示**：检查 `icon` 是否是完整的 `data:image/svg+xml;base64,<base64>`（注意没有换行、没有截断）；换图标时保持与 `icon.svg` 一致。

**安装失败**：npm 源要求包名与版本能在 registry 解析（`npm view dsh-notice@1.0.0 version`）；确认 `package.json` 不再 `private: true`、版本已发布、网络/代理可访问 registry。

**索引里的版本和 npm 对不上**：`scripts/validate-market-index.mjs` 会把索引首个版本与 `package.json` 的 `version`、`engines.dsh` 交叉比对，也会把内联图标与 `icon.svg` 比对——发布前后各跑一次即可避免。

## 相关文档

- [README](../README.md)：安装、配置、已知限制
- [docs/release.md](./release.md)：完整发版 runbook（版本、CHANGELOG、npm publish、tag）
- [docs/dev-loop.md](./dev-loop.md)：真机开发环境与验证工具链
- [docs/spec.md](./spec.md)：插件行为规格

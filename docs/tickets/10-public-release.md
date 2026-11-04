Status: in-progress

## Parent

#1

## What to build

把 v1.0.0 公开发布出去：

- npm 发布 `dsh-notice@1.0.0`（public，unscoped，MIT）；
- GitHub：push `main`、打 tag `v1.0.0`、创建 Release（含安装方式、兼容范围、已知限制）；
- DSH 插件市场：提供 **format-1 插件索引**（仓库根 `plugin-market-index.json`，GitHub raw 托管），用户在 Plugins → Discover → Add index source 添加索引 URL 后搜索/安装；
- 工程化：GitHub Actions CI（`node --test` + `npm pack --dry-run` 校验），`docs/release.md` 发布/更新 runbook（含 DSH 版本升级后的兼容维护策略）；
- README（插件市场安装 / npm 安装 / 版本与更新 / 英文摘要）、CHANGELOG、发布记录。

## 约定

- DSH 是快速迭代的宿主，**版本变化导致插件失效属正常情况**；维护方式：按 `docs/release.md` 在 DSH 新版本上重跑真机清单（[spikes/08](../spikes/08-acceptance-release.md)），同步 `engines.dsh`（package.json 与插件索引两处），发布 patch/minor 版本，并更新索引的版本列表。
- 插件市场是**自定义索引**机制（不是中心化商店）：我们的索引是第三方来源，用户添加后自行确认信任；索引 URL 固定为 `https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json`。
- 插件索引与 npm 包内容必须一致（name/version/engines.dsh），由 `scripts/validate-market-index.mjs` + `test/market-index.test.js` 守护；每个新版本发布时同步更新索引。

## Acceptance criteria

- [ ] `npm view dsh-notice` 能查到 `1.0.0`，且包内容包含宿主/客户端两半身 + `cordis.patch.yml` + `focus.ps1` + locale/icon
- [ ] GitHub `main` 与本地一致、tag `v1.0.0` 存在、Release 页面包含安装/兼容/已知限制说明
- [ ] 插件索引 JSON 能通过 format-1 校验，`plugin-market-index.json` 与 npm 包元数据一致（name/version/engines.dsh）
- [ ] 本机 DSH Discover 添加索引 URL 后能看到 `dsh-notice` 并可安装（用户确认）
- [ ] CI 在 push 上通过；`docs/release.md` 覆盖 npm 发布/GitHub release/索引更新/DSH 升级维护/回滚
- [ ] README / CHANGELOG / 本地 ticket 更新完成

## Blocked by

- #8（已完成）

## 记录

- 发布/维护规范：[docs/release.md](../release.md)、[docs/marketplace.md](../marketplace.md)
- 版本与新功能来源：[spikes/08](../spikes/08-acceptance-release.md)、#7/#9 记录

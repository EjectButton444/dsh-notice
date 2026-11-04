## Parent

#1

## What to build

一个可被 DSH 插件管理器以本地目录安装的 `dsh-notice` 最小包：宿主半身空实现，客户端半身可被加载。加载后通过一次性调试触发，在 Windows 上弹出一条系统通知（Toast）。

这一票只验证两个架构级风险（R1/R2），不做注意力检测、不做通知规则：

- 第三方客户端插件能否被安装、激活、加载（`dsh.bundle.patch` + `dsh.client` + 本地 link 安装）；
- 渲染进程的 Web Notification 在 Windows 上的实际表现：**归属名、图标、声音、锁屏内容**。

若 Toast 不可接受，记录结论并先更新 ADR-0001，再决定是否改走宿主侧 PowerShell Toast 路线。同时验证本地开发环：修改客户端代码后约 500ms 热替换生效。

## Acceptance criteria

- [ ] 插件能被 DSH 插件管理器以本地目录安装，并出现在插件列表
- [ ] 客户端半身被加载，一次性调试触发能让 Windows 弹出系统通知
- [ ] Toast 的归属名 / 图标 / 声音 / 锁屏内容实测结论写入 issue 评论
- [ ] 若结论推翻 ADR-0001，先更新 ADR 并记录替代方案，再继续后续 ticket
- [ ] 修改客户端代码后约 500ms 热替换生效

## Blocked by

None (can start immediately)

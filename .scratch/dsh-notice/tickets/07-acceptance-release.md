## Parent

#1

## What to build

收尾验收与发布准备：

- 在真机上按 spec 的 7 条验收标准全量验证并修复差距；
- 补齐 README：安装步骤、配置说明、升级后检查清单、已知限制（AUMID 归属、点击冷启动 1–3 秒、不能定位到具体会话）；
- 把 AUMID / Toast 的实测结论与降级方案写进文档；
- 清理一次性调试触发等临时代码，跑最终 code review，保持仓库整洁。

## Acceptance criteria

- [ ] spec 的 7 条验收标准全部通过，并逐条记录实测结果
- [ ] README 含安装 / 配置 / 升级检查清单 / 已知限制
- [ ] 最终 code review 无阻塞问题
- [ ] 仓库无残留调试代码 / 一次性触发
- [ ] 相关 ADR / GLOSSARY 与最终实现一致（如有偏差已更新）

## Blocked by

- #6
- #7

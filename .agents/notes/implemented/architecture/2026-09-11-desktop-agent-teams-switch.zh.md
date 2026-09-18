# Agent Note：桌面 Agent Teams 离线选择

Status: implemented

[English](2026-09-11-desktop-agent-teams-switch.md) | 中文

## 问题

桌面用户需要关闭 Teams 后无需下载依赖即可恢复。Hub 控制退役后，profile 升级仍须保留用户的选择。

## 决策

两个官方 Teams 模块始终包含在生产运行时中，新便携 profile 默认同时选择它们。DSH 原生插件管理器分别列出 Host 和 Web 模块；关闭两个模块即可关闭 Teams 执行与展示，并保留其依赖文件。

迁移将旧 `dsh.desktop.agentTeams` 选择转换为原生 `dsh.profile.bundles`，随后删除旧字段。旧值明确为 false 时关闭两个模块，否则分别保留已有模块选择。后续种子升级只读取原生选择，避免旧字段重新开启用户关闭的模块。

## 考虑过的替代方案

分支专用的组合开关会重复官方界面，并需要额外的生命周期接口。本发行版遵循原生行为，并在文档中说明完全关闭 Teams 需要关闭两个模块。

## 影响

切换不会缩小应用体积或触发包下载。Office 保持安装，并通过原生服务查询识别 Teams 已关闭。迁移与实际成品 RPC 检查覆盖启停选择保留、离线重新启用及过时 Hub 依赖移除。

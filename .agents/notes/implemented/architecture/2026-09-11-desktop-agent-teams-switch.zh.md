# Agent Note: 桌面 Agent Teams 离线开关

Status: implemented

[English](2026-09-11-desktop-agent-teams-switch.md) | 中文

## Problem

内部桌面用户需要关闭实验性 Teams，并在无法访问 registry 时重新开启。删除 npm 包会让恢复依赖下载，还可能导致 Host 与 Web 两层状态不一致。

## Decision

桌面插件管理器提供一个本地化的 Teams 开关。两个官方 bundle 注册同时变化；包依赖和缓存字节始终保留。profile manifest 使用 `dsh.desktop.agentTeams` 记录选择。未保存选择时沿用发布版本的默认值，明确选择则跨重启和 seed 升级保留。这部分取代[便携分发说明](2026-09-10-desktop-portable-distribution.zh.md)中固定启用的决策；其运行时、registry、打包和数据目录决策继续有效。

切换使用已有的暂存 profile 事务、离线冻结安装、后端健康检查、激活日志和回滚。Electron 串行执行功能与插件变更。Host 声明支持空闲重启，检查存活 agent 和处理中的 API 响应，然后在同一事件循环轮次接受关闭。仍有工作时拒绝切换；不支持此能力的旧 Host 需要更新应用。成功切换后刷新主窗口。会话和 Teams 存储不会删除。

## Alternatives considered

**提供两个可卸载插件。** 单独卸载可能隐藏面板却保留团队工具，重新安装还可能需要 registry。单一开关保留两层及其依赖。

**只改变可见面板。** 这会让模型侧的团队工具继续启用，与关闭 Teams 的含义不符。

## Consequences

关闭 Teams 不会缩小应用体积。重新启用需要本地安装和后端重启，但无需下载包。为使现有 profile 获得 Host 的空闲重启能力，需要新的桌面构建序号。

定向测试覆盖本地化开关输出、拒绝后的状态恢复、agent 和 API 工作期间的空闲检查、离线事务、回滚、插件保留与升级持久化。打包运行时验证覆盖真实 Host 启动及两种状态下的 Teams 客户端注册。Windows 原生执行仍由发布工作流负责；这些检查不需要真实模型调用。

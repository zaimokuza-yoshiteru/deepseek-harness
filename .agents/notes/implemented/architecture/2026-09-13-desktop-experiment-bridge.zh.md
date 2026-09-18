# Agent Note：桌面实验功能原生管理

Status: implemented

[English](2026-09-13-desktop-experiment-bridge.md) | 中文

## 问题

DSH alpha.2 已提供原生模块管理。保留 Hub 专用的 Electron 实验功能接口会重复管理状态，并使已退役 Hub 继续出现在升级路径中。

## 决策

便携应用使用 DSH 原生插件管理器，不再暴露 Hub 实验功能 IPC、preload API、私有空闲关闭协议或独立包管理窗口。原生 profile 操作负责模块启停与运行时重载。[Teams 说明](2026-09-11-desktop-agent-teams-switch.zh.md)定义保留的离线行为。

种子迁移先将完整旧 profile 移入私有备份，再从当前依赖和模块选择中移除 Hub。其他用户插件、配置和会话保留。原生管理器负责其并发与错误处理，Electron 保留上游进程关闭和恢复机制。

## 考虑过的替代方案

同时保留原生与 Hub 控制会留下过时接口，并可能导致启停状态不一致。本分支删除专用接口，直接验证原生管理器与打包插件的集成。

## 影响

渲染进程仍运行在沙箱中，不启用 Node integration。成品验证覆盖安装 ACP、Office 后的原生模块列表和 Teams 离线切换，以及 profile 迁移和 Windows Devin 文件链接回退。真实模型服务测试与这些确定性的发行检查分别执行。

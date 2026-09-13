# Agent Note: 通过 Plugin Hub 管理桌面实验性功能

Status: implemented

[English](2026-09-13-desktop-experiment-bridge.md) | 中文

## Problem

Plugin Hub 为 Web 和 Desktop 提供统一的资源管理页，但桌面 profile 的管理者运行在 Electron 中。渲染进程直接写入 profile 文件无法协调空闲关闭、暂存激活或回滚。向主应用开放包管理 IPC 会授予实验性功能开关并不需要的权限。

## Decision

应用 preload 暴露 `window.dshDesktop.experiments`，提供版本 `1`、`list()` 和 `setEnabled(change)`。仅当前主窗口的顶层 `dsh-app://app` frame 可以调用这些处理器。管理窗口保留包操作，但不提供实验性功能方法或 Teams 开关。主应用中的脚本共享实验性功能权限；桥接不验证各个插件的身份。

当前功能白名单仅包含 `agent-teams`。每次变更携带宿主返回的规范化 profile、目标 `enabled` 状态和已观察的 `expectedEnabled` 状态。宿主仅用 profile 做相等性校验，拒绝过期状态，不接受渲染进程指定文件写入位置。不支持的版本或源码开发启动器不声明可管理的实验性功能。

宿主分别报告配置状态 `enabled`、后端观察状态 `activeEnabled`、安装情况、切换能力和忙碌状态。`activeEnabled: null` 表示没有已确认的运行状态。[Teams 离线事务](2026-09-11-desktop-agent-teams-switch.zh.md)负责共享变更锁、空闲关闭、离线暂存和恢复。成功响应在后端恢复后返回，并要求渲染进程刷新；Hub 收到响应后刷新。失败返回稳定错误码并保留页面，供 Hub 提示错误和读取恢复后的状态。

每个沙箱 preload 独立打包。构建产物可以 require Electron，但不能 require 共享的本地分块。桌面构建使用受限加载器执行两个产物来验证该要求。

后端管道清理销毁各 Node 流并等待 close 事件。即使设置 `autoClose: false`，销毁流也会关闭其描述符；另行关闭描述符会与该清理竞争。发布冒烟检查拒绝非零子进程退出，并用打包后端验证离线关闭及重新开启。

## Alternatives considered

**由 Hub 写入 Desktop profile。** 这会绕过 Electron 的事务管理，无法安全同步后端关闭和回滚。

**开放完整的管理 preload。** 安装和删除包不是 Teams 开关所需的权限。独立 preload API 保留按窗口划分的权限。

**同时保留原生和 Hub 开关。** 两个入口会重复实现界面和状态处理。Hub 负责实验性功能界面；原生窗口保留包管理。旧版 Hub 需要更新后才能操作此桥接。

## Consequences

Web 继续管理原生 CLI profile，无需修改上游源码。Desktop 需要本 fork 的 preload 和 IPC 适配，同时保留现有事务实现。新增功能 ID 必须有明确的宿主实现；不接受任意包名和可执行回调。

定向测试覆盖调用者拒绝、过期请求、忙碌拒绝、成功重启确认、恢复失败及未知运行状态，以及不含 Teams 开关的中英文包管理器输出。构建产物验证执行受限加载器。原生 Electron 窗口交互和 macOS/Windows 打包分发仍由发布级验证负责。

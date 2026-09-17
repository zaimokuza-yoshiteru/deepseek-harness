# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

[English](2026-09-10-desktop-portable-distribution.md) | 中文

## Problem

内部使用者需要双击启动的桌面应用，不单独安装 harness 或 JavaScript 工具。安装插件时也需要复用已有的 Nexus registry 和 TLS 配置。上游签名发布要求证书设施，并使用固定的包 registry。

## Decision

`desktop` 分支提供 macOS arm64 与 Windows x64 ZIP，内置预构建的生产核心、原版 Node.js、pnpm 和三个固定版本插件。后端通过 Electron 的 Node 模式从 ASAR 执行，包操作使用独立的原版 Node 可执行程序。迁移通过上一版清单识别已移除的核心包，仅当依赖仍指向清单记录的本地压缩包时才按旧核心处理。应用启动时不安装核心依赖；准备期间先显示启动页，同一个后端负责就绪检查和应用请求。

核心包含 DSH `0.1.6-alpha.1` 及随后上游的启动优化。ACP adapter `0.1.6-alpha.1.6`、Plugin Hub `0.2.3` 与 Agent Teams Office `0.1.0-beta.1` 预构建为独立的可写 profile 模板，通过锁文件验证 npm 完整性。指定的 GitHub tag `0.1.6.alpha.1.5` 映射为内部 SemVer `0.1.6-alpha.1.5`，依赖版本与桌面构建序号分离。

首次启动复制已准备好的插件模板，不调用 pnpm。模板升级先将原 profile 移入私有迁移备份，保留用户配置及启用状态，再验证新依赖图；准备失败时恢复原文件。内置插件版本跟随应用发布，额外用户插件保留精确版本，迁移时可能需要访问 registry。

内置 pnpm 与仓库工具统一使用 `11.23.0`。包操作读取用户 npmrc 及 npm 环境覆盖值，包括 scope registry 凭证与 TLS 配置，不将个人配置复制到发布资源中；包存储仍由应用独立管理。macOS 导入登录交互 shell 的导出变量，具体排除项及超时由[桌面 README](../../../../apps/desktop/README.zh.md#environment-and-registry)定义。Windows 继承启动环境。

本分支默认使用独立桌面数据目录，支持显式主目录与遥测设置，默认关闭遥测及自动更新。原生编辑菜单恢复标准快捷键，HTTP/HTTPS 链接由外部浏览器打开，并在右键菜单显示地址。两个 Teams bundle 始终保留在核心中，其注册由 [Hub 接口](2026-09-13-desktop-experiment-bridge.zh.md)控制。

Office 使用现有 Team 服务和 Connection 通信，不新增独立服务器。预构建渲染器及第三方许可声明保留在插件模板中。关闭 Teams 时 Office 仍可保持安装；成品检查覆盖其启用与禁用状态的响应。

成品中的 adapter 检查模拟 Windows 文件符号链接被拒绝，验证硬链接回退、MCP 配置隔离、文件共享写入及不删除源文件的清理行为。回归检查使用合成配置，不启动需要登录的 Devin 进程。

## Alternatives considered

**要求系统运行时。** 这可以减小压缩包，但不符合使用者的安装要求，因此内置运行时与离线 seed。

**复用上游签名安装包。** Developer ID、公证和 Windows EV Token 配置不属于此次内部分享范围。macOS 使用 ad-hoc 签名，Windows 不签名，操作系统仍可能要求批准。

**仅替换 registry 常量。** 固定的 Nexus 地址不能适应不同使用者的 registry、认证与 CA 设置。读取用户 npmrc 可以保留这些已有配置。

## Consequences

压缩包包含各平台生产依赖，不含个人 npm 配置。用户通过替换完整应用升级；迁移备份可能含个人设置，只应在本地管理。macOS 临时签名及 Windows 未签名 ZIP 仍可能触发系统安全确认。

验证覆盖真实 npm TLS 配置、迁移恢复、shell 环境解析、单后端启动、成品客户端模块及离线 Teams 切换。完整文件校验在打包时执行，常规启动检查运行时标识与插件锁状态。GitHub Actions 验证原生 Windows 打包；真实模型服务与外部 ACP 登录需要独立用户凭证。

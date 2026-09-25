# Agent Note: 便携桌面发行与原生插件管理

Status: implemented

[English](2026-09-10-desktop-portable-distribution.md) | 中文

## 问题

内部使用者需要无需单独安装 DSH、Node.js 或包管理器即可双击运行的应用，支持 Nexus/TLS 配置，且不要求管理员权限。Teams 必须支持离线启停，升级须保留用户选择，不能再引入另一套插件管理机制。

## 决策

desktop 分支生成 macOS arm64 与 Windows x64 ZIP。核心依赖由 Electron Node 模式从 ASAR 执行，保留内置 Node/Python 和文档工具运行时。原生启动页面在 profile 准备前显示，应用只运行一个 Host。首次启动复制以 npm integrity 锁定的预构建 ACP 和 Office 依赖；其他用户插件在迁移时可能需要访问 registry。精确版本由 [portable-plugins.ts](../../../../apps/desktop/src/portable-plugins.ts) 管理，[桌面 README](../../../../docs/user/guide/desktop-portable.zh.md) 负责发行编号、独立数据路径、遥测默认值、shell/npm 配置、菜单与链接。个人配置、凭证和备份不作为发行输入。

DSH 原生插件管理器负责启停、重载、并发与错误处理，Electron 保留上游关闭和恢复机制。不再保留 Hub 实验功能 IPC、preload API、私有空闲关闭协议或独立包管理窗口。渲染进程仍运行在沙箱中，不启用 Node integration。官方 Teams 组合包包含 Host 和 Web 模块，新 profile 默认启用。切换状态保留依赖且不改变应用体积；Office 保持安装，通过原生服务查找感知 Teams 已禁用。

种子迁移将完整旧 profile 备份到 `desktop/migration-backups/<UUID>`，准备失败时恢复。迁移移除 Hub 和已退役的独立 Teams Web 组合包，保留其他插件、配置和会话。旧本地核心 tarball 根据历史清单和精确声明识别。旧字段 `dsh.desktop.agentTeams` 被移除：显式 false 禁用 Teams，否则原 Host 选择保留在 `dsh.profile.bundles` 中。后续升级读取原生选择，过时字段不能重新启用 Teams。

依赖安装、编译、打包与验证均以非 root 且无管理员组身份运行。Windows 使用临时普通账号；macOS 临时移除已登录 runner 的管理员组身份，完成后恢复，保留文档转换所需的 Aqua 会话。特权操作仅用于准备或恢复构建身份及访问权限。GitHub Release 发布同一批已验证压缩包。

## 考虑过的替代方案

依赖系统运行时可以减小体积，但不满足离线启动要求。证书签名安装包需要独立签名基础设施；便携构建采用 macOS 临时签名和未签名 Windows ZIP，因此仍可能出现系统批准提示。自定义 Teams 开关或保留 Hub 会重复管理原生状态，并要求另一套生命周期接口。

## 影响

成品检查覆盖 npm TLS、shell 导出变量、[原生图标](../bug-fix/2026-09-11-desktop-finder-icons.zh.md)、安装 ACP 和 Office 后的插件列表/RPC、Teams 离线恢复启用、启停选择保留、Hub 移除、回滚及旧 profile 迁移。Devin 检查使用打包 Electron、合成 CLI 配置和真实 MCP stdio/HTTP 传输，在不读取用户凭证的前提下验证固定注册、并发会话隔离和能力撤销。这些确定性检查不能代替真实服务登录或模型测试。

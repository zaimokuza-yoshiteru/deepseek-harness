# DSH Desktop 便携分发

[English](desktop-portable.md) | 中文

## Summary

本分支提供 macOS Apple Silicon 与 Windows x64 ZIP，内置 DSH `0.1.7-rc.2`、ACP adapter `0.1.7-rc.2.0` 和 Agent Teams Office `0.1.0-beta.6`。使用者无需另外安装 DSH、Node.js、npm 或 pnpm。Devin、Kimi 等 Agent 命令仍需自行安装。

## Table of Contents

- [打开应用](#open-the-application)

- [插件与 Teams](#plugins-and-teams)

- [环境与-registry](#environment-and-registry)

- [数据与升级](#data-and-upgrades)

- [构建与发布](#build-and-release)

## Open the application

完整解压 ZIP。macOS 打开 `DSH Desktop.app`，Windows 打开 `DSH Desktop.exe`；Windows 可执行文件必须与相邻文件放在一起。Mac 应用使用临时签名，未公证，系统可能要求安全确认；Windows 程序未签名。

Windows 请使用较浅的解压目录，例如 `C:\DSH`。内置原生 Office 引擎在应用路径嵌套过深时仍可能无法初始化，即使文件完整也会失败；尚无已验证的统一安全路径长度上限。如果在深层目录解压后文档转换失败，请关闭应用，将整个解压文件夹移到较短路径，再重新打开。数据目录与 profile 保持原位。

窗口先显示原生启动页面，再启动一个后端。核心生产依赖从应用 ASAR 执行，启动时无需安装。首次启动将预先准备的插件依赖复制到可写 profile。应用同时携带官方 Node/Python 和文档工具运行时，按需在数据目录中准备。Office CLI、选定的原生引擎及其依赖闭包从 ASAR 解包，供内置 Node 执行。CI 解压发行 ZIP，核验完整运行时清单，转换 DOCX、XLSX 和 PPTX，并在空 PATH 下执行技能 CLI。Release 晋级时按该次成功 smoke 记录的 SHA256 核验 ZIP。

原生编辑菜单支持全选、复制、粘贴、剪切、撤销和重做。聊天链接遵循原生“聊天链接打开方式”设置。新窗口 HTTP/HTTPS 链接由系统浏览器打开，链接右键菜单可打开或复制原地址。

## Plugins and Teams

点击应用侧栏的 **插件**，打开 DSH 原生插件管理器。选择安装操作，输入 `@scope/plugin-name@version` 形式的包信息，检查包信息后安装。插件必须兼容 DSH `0.1.7-rc.2`。安装、删除与启停由原生管理器负责，并由其提示需要的重载或受阻操作。应用不再内置 Plugin Hub 及其桌面 IPC 接口。

新 profile 默认启用 Agent Teams。原生管理器提供一个包含 Host 和 Web 模块的官方 Agent Teams 插件，启停该插件即可切换 Teams，无需下载依赖。迁移保留原 Host 插件的启用选择，并移除已退役的独立 Web 插件。

内置 Office 在团队会话的右侧边栏提供办公室入口，支持 3D 和像素视图，需要 WebGL，最多显示 16 个队友和一个 Lead。关闭 Teams 时入口隐藏；渲染库及许可声明随插件内置，重新开启不需要下载 Office。也可以在插件管理器中单独禁用 Office。

## Environment and registry

macOS 每次启动使用 `-ilc` 运行用户的 `$SHELL`（默认 `/bin/zsh`），由 shell 自行加载登录和交互配置；zsh 包括 `.zprofile`、`.zshrc`。仅导入已导出的环境变量；别名与 shell 函数不是可执行程序。读取超时为八秒，失败会显示启动错误。Windows 直接继承启动环境。

Shell 导入排除 `ELECTRON_*`、`DSH_DESKTOP_*`、`NODE_OPTIONS`、`NODE_PATH`、`PWD`、`OLDPWD`、`SHLVL` 和 `_`，其他导出变量（包括凭证、代理与 `npm_config_*`）保留。桌面数据主目录保持应用已选择的值。内置 Node 加在 PATH 末尾，优先使用用户已安装的 Node。应用不会收录个人 shell 文件或环境快照。

内置 pnpm `11.23.0` 读取 `~/.npmrc` 或 `npm_config_userconfig` 指定的文件，支持 scope registry、认证、CA 证书及 `strict-ssl=false`。`npm_config_registry` 和 `npm_config_strict_ssl` 可覆盖文件配置。无需系统 npm。放宽 TLS 校验仅作用于包管理操作，包存储遵循 pnpm 配置。

## Data and upgrades

致命启动错误报告在 Electron 日志目录保留最近十份文件：macOS 为 `~/Library/Logs/DSH Desktop`，Windows 为数据目录下的 `electron-user-data/logs`。报告可能包含错误和渲染进程诊断，分享前请检查内容。插件资源响应使用 `no-store`，避免 Chromium 磁盘缓存保留各次启动产生的旧资源。

默认数据目录为 `~/.dsh-desktop`，尊重显式设置的 `DSH_HOME`。Electron 数据位于 `electron-user-data`，插件文件位于 `profiles/desktop`。遥测默认关闭。升级时替换整个应用；此发行版不自动更新，也不发布 npm 包。

插件模板升级先将完整 profile 备份到 `desktop/migration-backups/<UUID>`，保留 Teams 和其他插件的启停选择，并将 ACP 与 Office 固定为本发行版版本。已退役 Hub 的依赖声明和模块选择从当前 profile 移除，旧文件仍保留在备份中。其他用户插件保留版本，迁移时可能需要访问配置的 registry。准备失败会恢复原 profile。旧核心 tarball 根据历史发行清单和精确的本地依赖声明识别。备份可能包含个人配置，应仅在本地保管。会话和工作区不会被删除。

## Build and release

在对应操作系统上使用仓库锁定依赖构建：

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/desktop run package:portable:mac:arm64
```

Windows 构建命令为 `pnpm --dir apps/desktop run package:portable:win:x64`。GitHub Actions 以无管理员身份安装依赖、构建和验证最终应用。Windows 使用临时普通账号；macOS 保留 runner 的桌面登录会话，在构建和 GUI 检查期间移除管理员组身份，完成后恢复。未登录桌面的新建账号会导致原生文档转换程序崩溃。仅账号准备和恢复操作使用管理权限。检查涵盖原生插件管理、ACP/Office RPC、Teams 离线开关、profile 迁移和 Devin 固定 stdio MCP 入口和会话能力隔离。构建产物、诊断、profile、签名材料和凭证不进入 Git。标签 `0.1.7.rc.2.1` 对应应用 SemVer `0.1.7-rc.2.1`，核心包保持 `0.1.7-rc.2`。

**Desktop portable smoke replay** 工作流接受已有构建的 run ID。Windows 会解压该次构建的原始 ZIP，核验普通用户身份，分别测量全新 profile 的 GUI 启动，以及完全退出后使用同一 profile 再次启动。在 `desktop-startup-win-x64` 产物中查看 `result.json` 和截图：就绪标准为账号菜单可见且成功打开设置对话框。macOS 构建也会以普通用户身份执行此 GUI 检查。报告记录 ZIP 的 SHA256 和渲染页面的绘制时间。启动计时不含 ZIP 解压，也不代表用户电脑的安全扫描或操作系统冷缓存表现。macOS 重测保留后端检查。

便携标签采用 `0.1.7.rc.2.<counter>`，应用元数据采用 `0.1.7-rc.2.<counter>`。核心与插件版本分别固定。标准上游安装包命令从 package manifest 推导版本。

便携 ZIP 不签名，也不需要 EV token。上游签名安装包脚本仍可用于单独的证书管理发行，其签名前置检查不在便携工作流中执行。

桌面壳采用上游生产依赖布局，包含 API Gateway 及其 Cordis peer。依赖在构建阶段安装，应用启动时从本地加载。macOS 便携构建在记录运行时哈希之前，为文档转换辅助程序执行保留上游 JIT 权限的临时签名，无需开发者证书或管理员账户。

便携构建通过 [GitHub Release 晋级流程](../../../.github/workflows/desktop-promote.yml)发布已验证的 CI ZIP 和 SHA256 校验文件，不上传到上游自动更新服务。

## Dev Note

参见[便携发行与原生插件管理决策](../../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.zh.md)。运行时与用户插件依赖图保持分离，渲染进程不启用 Node integration。

# DSH Desktop 便携分发

[English](README.md) | 中文

## Summary

本分支提供 macOS Apple Silicon 和 Windows x64 压缩包，内置 DSH `0.1.6-alpha.1`、ACP adapter `0.1.6-alpha.1.4`、Plugin Hub `0.2.3` 和 Agent Teams Office `0.1.0-beta.1`。核心包含该版本发布后的上游启动优化。使用者无需另装 DSH、Node.js、npm 或 pnpm；Devin、Kimi 等 Agent 命令仍需自行安装。

## Table of Contents

- [打开应用](#open-the-application)

- [插件与 Teams](#plugins-and-teams)

- [环境与-registry](#environment-and-registry)

- [数据与升级](#data-and-upgrades)

- [构建与发布](#build-and-release)

## Open the application

完整解压 ZIP。macOS 打开 `DSH Desktop.app`，Windows 打开 `DSH Desktop.exe`；Windows 可执行文件必须与相邻文件放在一起。Mac 应用使用临时签名，未公证，系统可能要求安全确认；Windows 程序未签名。

窗口先显示启动页，再启动一个后端。核心生产依赖从应用 ASAR 中运行，启动时不安装核心依赖；首次仅将已准备好的插件依赖复制到可写 profile。完整运行时校验在打包期间执行，后续启动比较运行时与插件锁文件标识。

原生编辑菜单支持全选、复制、粘贴、剪切、撤销和重做。HTTP/HTTPS 链接由系统浏览器打开，链接右键菜单可显示并复制原始地址。

## Plugins and Teams

从应用菜单打开 **桌面插件…**，或使用 macOS 的 `Cmd+,`、Windows 的 `Ctrl+,`。按 `@scope/plugin-name@version` 格式输入 registry 包信息，再点击 **安装**。插件需要符合当前 DSH 桌面端的依赖约定；例如 theme-library `0.2.1` 需要先在插件包中修正 peer dependency 声明，才能安装。列表支持启用、禁用、更新与移除；包变更会重启后端，请先结束运行中的任务。安装失败时可继续在该窗口修复。

新 profile 默认启用 Agent Teams。在 Plugin Hub 的实验性功能页关闭或开启即可。两个官方 Teams 配置层同步切换，依赖始终内置，因此开关不需要下载或安装。Agent 或 API 请求仍在运行时，桌面端拒绝切换；允许切换后，后端完成重启才会确认成功。

内置 Office 在团队会话的右侧边栏提供办公室入口，支持 3D 和像素视图，需要 WebGL，最多显示 16 个队友和一个 Lead。关闭 Teams 时入口隐藏；渲染库及许可声明随插件内置，重新开启不需要下载 Office。也可以在插件管理器中单独禁用 Office。

## Environment and registry

macOS 每次启动使用 `-ilc` 运行用户的 `$SHELL`（默认 `/bin/zsh`），由 shell 自行加载登录和交互配置；zsh 包括 `.zprofile`、`.zshrc`。仅导入已导出的环境变量；别名与 shell 函数不是可执行程序。读取超时为八秒，失败会显示启动错误。Windows 直接继承启动环境。

Shell 导入排除 `ELECTRON_*`、`DSH_DESKTOP_*`、`NODE_OPTIONS`、`NODE_PATH`、`PWD`、`OLDPWD`、`SHLVL` 和 `_`，其他导出变量（包括凭证、代理与 `npm_config_*`）保留。桌面数据主目录保持应用已选择的值。内置 Node 加在 PATH 末尾，优先使用用户已安装的 Node。应用不会收录个人 shell 文件或环境快照。

内置 pnpm `11.23.0` 读取 `~/.npmrc` 或 `npm_config_userconfig` 指定的文件，支持 scope registry、认证、CA 证书以及 `strict-ssl=false`。`npm_config_registry` 和 `npm_config_strict_ssl` 可覆盖文件设置，不需要系统 npm。包管理器存储位于桌面数据目录中，TLS 放宽仅用于包操作。

## Data and upgrades

默认数据目录为 `~/.dsh-desktop`，支持显式 `DSH_HOME`。Electron 数据位于 `electron-user-data`，插件文件位于 `profiles/desktop`，包管理器状态位于 `desktop/pnpm`。遥测默认关闭。升级时替换完整应用；本分发不自动更新，也不发布 npm 包。

插件模板升级会在 `desktop/migration-backups` 保留备份，保留 Teams 与插件启用状态，并将三个内置插件更新到本次固定版本。额外安装的插件保留版本，迁移时可能需要访问配置的 registry。准备失败会恢复原 profile。旧核心包通过上一版清单及精确本地依赖路径识别和移除，包括新版不再包含的包。备份可能含个人配置，应仅在本地管理；迁移不会删除会话与工作区。

## Build and release

在对应操作系统上使用仓库锁定依赖构建：

```sh

pnpm install --frozen-lockfile

pnpm --dir apps/desktop run package:portable:mac:arm64

```

Windows 命令为 `pnpm --dir apps/desktop run package:portable:win:x64`。GitHub Actions 执行两平台构建及成品离线启动测试。测试除核心启动外，还检查成品中的插件依赖、Host 和 Remote RPC 元数据注册，以及实际 ACP 和 Plugin Hub 请求。构建产物、诊断、个人 profile、签名材料和 npm 凭证不进入 Git 历史。Tag `0.1.6.alpha.1.3` 对应应用内部合法 SemVer `0.1.6-alpha.1.3`；核心包版本保持 `0.1.6-alpha.1`。

## Dev Note

参阅[便携分发决策](../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.zh.md)和[实验功能接口](../../.agents/notes/implemented/architecture/2026-09-13-desktop-experiment-bridge.zh.md)。运行时与用户插件依赖图保持分离，渲染器不启用 Node 集成。

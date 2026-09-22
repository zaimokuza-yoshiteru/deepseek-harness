# Agent Note：支持 npm 配置的桌面 ZIP 发行

Status: implemented

[English](2026-09-10-desktop-portable-distribution.md) | 中文

## 问题

内部使用者需要无需单独安装 DSH 或 JavaScript 工具即可双击运行的应用。其他插件须支持已有 Nexus registry 和 TLS 配置，正常使用不能要求管理员权限。

## 决策

desktop 分支提供 macOS arm64 与 Windows x64 ZIP，内置 DSH `0.1.7-alpha.1`、ACP `0.1.7-alpha.1.1` 和 Office `0.1.0-beta.3`。标签 `0.1.7.alpha.1.1` 映射为应用 SemVer `0.1.7-alpha.1.1`。两个公开插件 tarball 均以 npm integrity 锁定，不含 Hub。

核心生产依赖由 Electron Node 模式从 ASAR 执行，保留官方内置 Node/Python 和文档工具运行时。原生启动页面在 profile 准备前出现，应用只运行一个 Host。首次启动复制预构建插件依赖，其他用户插件在迁移时可能需要访问 registry。

种子升级先将完整旧 profile 移入 `desktop/migration-backups/<UUID>`，再修改文件，准备失败时恢复。旧本地核心 tarball 根据其历史清单和精确声明识别。[原生实验功能决策](2026-09-13-desktop-experiment-bridge.zh.md)负责 Hub 移除和 Teams 状态迁移。会话与工作区不清空。

[桌面 README](../../../../apps/desktop/README.zh.md#environment-and-registry)说明 shell 导入、npmrc 优先级和精确的导出变量排除规则。保留隔离桌面数据目录、遥测默认值、编辑菜单、原生图标和外链右键操作。个人 shell 文件、凭证及 profile 备份不作为发行输入。

CI 在两个平台分别创建临时普通账号，依赖安装、编译、ZIP 创建及成品检查都由该账号执行，并以断言拒绝 root 或管理员身份。runner 管理权限仅用于创建账号和授予临时检出的访问权限。同一批验证过的压缩包被提升为 GitHub Release。

## 考虑过的替代方案

要求系统运行时可以减小压缩包，但违反离线启动要求。官方签名安装包需要独立证书基础设施，本发行版采用 macOS ad-hoc 签名和未签名 Windows ZIP，操作系统仍可能显示批准提示。

## 影响

验证覆盖 npm TLS 配置、shell 导出变量、图标、原生插件 RPC、Teams 离线切换、回滚和旧 profile 迁移。Devin 检查通过打包 Electron 的 Node 模式、合成原生 CLI 配置及真实 MCP stdio/HTTP 传输，验证固定注册、并发会话隔离和能力撤销，不读取凭证。真实服务登录与在线模型测试单独进行。

# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

[English](2026-09-10-desktop-portable-distribution.md) | 中文

## Problem

内部使用者需要双击启动的桌面应用，不单独安装 harness 或 JavaScript 工具。安装插件时也需要复用已有的 Nexus registry 和 TLS 配置。上游签名发布要求证书设施，并使用固定的包 registry。

## Decision

`desktop` 分支将本地核心包、原版 Node.js、pnpm 和精确版本的 ACP adapter 打包为 macOS arm64 与 Windows x64 ZIP。桌面分发版本在固定的 DSH 版本后追加正整数构建序号。seed 记录两个版本，profile 校准会比较构建序号，使相同 DSH 基线的桌面修订也能替换后端资源。

当前分发固定 DSH `0.1.5-rc.2` 的上游提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203`，以及 ACP adapter `0.1.5-rc.2.1` 的源码提交 `4cc5210f8c3c39c19bb7227c8e9cab27b91e331d`；seed 准备阶段校验 npm 包完整性。升级时，seed 中的插件版本优先于这些包原先安装的版本。其他插件保留精确版本和注册。工作区策略按各 profile 记录的 DSH 版本生成，使 alpha profile 仍可读取，而 rc seed 使用对应精确 adapter 版本的发布时间例外。

仅升级时的 add 优先使用本地缓存，并信任已验证的 seed 锁文件。用户插件与新核心包重新解析时，可能从已配置的 registry 获取缺失的依赖元数据。固定 seed 的安装仍保持离线。普通插件变更保留原有策略检查。

内置 pnpm 固定为 `11.23.0`，修复 rc.1 到 rc.2 插件升级时复现的安装完成后 worker 不退出问题（[pnpm #12297](https://github.com/pnpm/pnpm/issues/12297)）。仓库构建工具使用同一版本，避免 Electron 收集依赖时发生包管理器版本不匹配。内置 pnpm 读取用户 npmrc，不将其复制进应用资源。npm 环境变量保留公开拼写，通用网络配置也映射为 pnpm 11 的环境变量拼写。包管理存储仍由应用独立管理。放宽 TLS 校验仅作用于包管理配置，不设置 Node 进程级 TLS 开关。

fork 默认采用独立的 DSH 根目录和 Electron 用户数据目录。菜单与启动流程不触发自动更新，遥测默认关闭。仍支持显式指定 DSH 根目录与遥测配置。GitHub tag 构建验证提交属于 desktop 分支，将 ZIP 和校验文件附到 prerelease，不发布 npm 包。

CI 在完整构建之前准备运行时，并记录下载、解压与复制阶段。Windows Node ZIP 使用 Electron 维护的原生解压器；原先的 `extract-zip` 实现在 Windows runner 上完成校验后，以未完成的顶层 await 错误退出。

Agent Teams 默认使用官方 Host 与 Web bundle，按该顺序放在 base 和 Web 之后。它们的依赖闭包从本地发布包复制，profile 校准把这两层视为应用自有组件。升级时仍可读取 alpha.2 与 rc.1 的原有层前缀；新 profile 和插件事务保留 Teams 前缀。adapter 的发布时间例外跟随其精确版本，包括额外的修订序号。DSH 没有独立 Teams 开关，此分发也不另加开关。插件卸载仅在 pnpm 填充暂存项目后读取已安装版本。

## Alternatives considered

**要求系统运行时。** 这可以减小压缩包，但不符合使用者的安装要求，因此内置运行时与离线 seed。

**复用上游签名安装包。** Developer ID、公证和 Windows EV Token 配置不属于此次内部分享范围。macOS 使用 ad-hoc 签名，Windows 不签名，操作系统仍可能要求批准。

**仅替换 registry 常量。** 固定的 Nexus 地址不能适应不同使用者的 registry、认证与 CA 设置。读取用户 npmrc 可以保留这些已有配置。

## Consequences

应用压缩包更大，并按平台分发。npm 凭据保留在使用者电脑上。精确版本与完整性校验固定适配器发布内容，agent 可执行程序仍由外部提供。桌面升级需要替换完整应用。插件仍须兼容桌面管道传输。

验证包含真实自签名 HTTPS registry、配置优先级测试、相同基线的构建升级测试，以及使用全新数据目录和不可达 registry 的打包后端冒烟检查与适配器清单检查。冒烟检查不运行真实 ACP agent 或模型服务，CI 负责原生 Windows 构建执行。

冒烟日志区分安装、后端启动、资源传输与激活阶段。后续冒烟失败时仍保留已完成的 ZIP，手动重跑工作流可以使用这些资源而不重新构建核心。重跑提供诊断证据，修改后的产品仍须通过完整构建后再分发。

Windows 上原先的首次启动流程在 pnpm 开始安装前花了 154 秒准备 store，冒烟上限打断了仍在推进的安装。持久化 store 尚不存在时，现在通过桌面数据根目录内的重命名直接采用已验证的解压结果，省去约 21,000 个文件的再次复制和删除。已有 store 仍执行合并，保留升级时的插件文件和包索引记录。Windows 冒烟预算为五分钟，用于覆盖实测的冷 store 准备、依赖安装和后端启动；macOS 保留三分钟。

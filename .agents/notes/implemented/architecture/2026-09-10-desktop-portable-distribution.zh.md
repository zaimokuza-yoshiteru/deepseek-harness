# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

[English](2026-09-10-desktop-portable-distribution.md) | 中文

## Problem

内部使用者需要双击启动的桌面应用，不单独安装 harness 或 JavaScript 工具。安装插件时也需要复用已有的 Nexus registry 和 TLS 配置。上游签名发布要求证书设施，并使用固定的包 registry。

## Decision

`desktop` 分支将本地核心包、原版 Node.js、pnpm 和精确版本的 ACP adapter 打包为 macOS arm64 与 Windows x64 ZIP。桌面分发版本在固定的 DSH 版本后追加正整数构建序号。seed 记录两个版本，profile 校准会比较构建序号，使相同 DSH 基线的桌面修订也能替换后端资源。

内置 pnpm 读取用户 npmrc，不将其复制进应用资源。npm 环境变量保留公开拼写，通用网络配置也映射为 pnpm 11 的环境变量拼写。包管理存储仍由应用独立管理。放宽 TLS 校验仅作用于包管理配置，不设置 Node 进程级 TLS 开关。

fork 默认采用独立的 DSH 根目录和 Electron 用户数据目录。菜单与启动流程不触发自动更新，遥测默认关闭。仍支持显式指定 DSH 根目录与遥测配置。GitHub tag 构建验证提交属于 desktop 分支，将 ZIP 和校验文件附到 prerelease，不发布 npm 包。

CI 在完整构建之前准备运行时，并记录下载、解压与复制阶段。Windows Node ZIP 使用 Electron 维护的原生解压器；原先的 `extract-zip` 实现在 Windows runner 上完成校验后，以未完成的顶层 await 错误退出。

## Alternatives considered

**要求系统运行时。** 这可以减小压缩包，但不符合使用者的安装要求，因此内置运行时与离线 seed。

**复用上游签名安装包。** Developer ID、公证和 Windows EV Token 配置不属于此次内部分享范围。macOS 使用 ad-hoc 签名，Windows 不签名，操作系统仍可能要求批准。

**仅替换 registry 常量。** 固定的 Nexus 地址不能适应不同使用者的 registry、认证与 CA 设置。读取用户 npmrc 可以保留这些已有配置。

## Consequences

应用压缩包更大，并按平台分发。npm 凭据保留在使用者电脑上。精确版本与完整性校验固定适配器发布内容，agent 可执行程序仍由外部提供。桌面升级需要替换完整应用。插件仍须兼容桌面管道传输。

验证包含真实自签名 HTTPS registry、配置优先级测试、相同基线的构建升级测试，以及使用全新数据目录和不可达 registry 的打包后端冒烟检查与适配器清单检查。冒烟检查不运行真实 ACP agent 或模型服务，CI 负责原生 Windows 构建执行。

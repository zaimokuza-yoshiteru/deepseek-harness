# Agent Note: 小尺寸 macOS 帧有效的原生桌面图标

Status: implemented

[English](2026-09-11-desktop-finder-icons.md) | 中文

## Problem

Finder 显示损坏的绿色小图标，而 Dock 图标仍可正常显示。electron-builder 26.15.3 附带的转换器把 PNG 内容写入旧式小尺寸 ICNS 帧，并使用错误的 Retina 尺寸。

## Decision

便携配置使用已提交的 ICNS 和 ICO 文件，它们由官方 `icons@1.2.3` 工具从桌面 SVG 生成。[上游修复](https://github.com/electron-userland/electron-builder-binaries/blob/master/packages/icons/CHANGELOG.md)采用 ARGB `ic04`/`ic05` 帧和正确的 Retina PNG 尺寸。资源完整性记录固定 SVG、原生输出和下载的工具压缩包。使用原生输入可避开旧 builder 的 SVG 转换路径。

## Alternatives considered

**清理 Finder 缓存。** 清理缓存无法修正每个已发布应用内部的错误字节。

**升级 electron-builder。** 这会把图标修复与签名、打包变更耦合。显式原生资源保留已有 builder，同时让修正后的字节可复现、可测试。

## Consequences

修改 SVG 后需要重新生成两种原生文件并刷新完整性记录。测试验证打包路径、摘要、ICNS 帧编码与尺寸，以及 ICO 的全部七种尺寸。macOS ImageIO 可解码全部十个修正后的帧，包括 16px 和 32px。发布验证比较应用图标与已提交资源；Windows 可执行文件资源检查核对内嵌 ICO 帧。接收者电脑特有的 Finder 缓存不属于压缩包字节验证范围。

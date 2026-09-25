# Agent Note: Portable desktop distribution and native plugin management

Status: implemented

English | [中文](2026-09-10-desktop-portable-distribution.zh.md)

## Problem

Internal recipients need a double-click application without separate DSH, Node.js or package-manager installation, with Nexus/TLS settings and no administrator requirement. Teams must toggle offline, and upgrades must retain user choices without a second plugin-management authority.

## Decision

The desktop branch produces macOS arm64 and Windows x64 ZIPs. Core dependencies run from ASAR under Electron Node mode; the Node/Python and document-tool payload remains bundled. A native startup page precedes profile preparation and one Host serves the application. First launch copies prebuilt ACP and Office dependencies, pinned by npm integrity; additional user plugins can require registry access during migration. Exact pins live in [portable-plugins.ts](../../../../apps/desktop/src/portable-plugins.ts), and the [desktop README](../../../../docs/user/guide/desktop-portable.md) owns release numbering, isolated data paths, telemetry defaults, shell/npm configuration, menus and links. Personal configuration, credentials and backups are not release inputs.

DSH’s native plugin manager owns activation, reloads, concurrency and errors; Electron retains upstream shutdown and recovery. No Hub experiment IPC, preload API, private idle-shutdown protocol or separate package-manager window remains. The renderer stays sandboxed without Node integration. The official Teams bundle includes Host and Web modules and is enabled in new profiles. Switching it retains dependencies and application size; Office stays installed and detects disabled Teams through the native service lookup.

Seed migration backs up the complete old profile under `desktop/migration-backups/<UUID>` and restores it on preparation failure. It removes Hub and the retired separate Teams Web bundle while preserving other plugins, configuration and sessions. Retired local core tarballs are recognized by their recorded inventory and exact specifications. The old `dsh.desktop.agentTeams` field is removed: explicit false disables Teams; otherwise the previous Host selection survives in `dsh.profile.bundles`. Later upgrades use native selections, so an obsolete flag cannot re-enable Teams.

Dependency installation, compilation, packaging and verification run without root or administrator membership. Windows uses a disposable standard account; macOS temporarily removes administrator membership from the logged-in runner and restores it afterward, preserving the Aqua session required by document conversion. Privileged operations only provision or restore the build identity and access. GitHub Release receives the same verified archives.

## Alternatives considered

System runtimes reduce archive size but defeat offline startup. Certificate-managed installers require separate signing infrastructure; portable builds use ad-hoc macOS signing and unsigned Windows ZIPs, so OS approval prompts remain possible. A fork-specific Teams toggle or retained Hub would duplicate native state ownership and require another lifecycle bridge.

## Consequences

Packaged checks cover npm TLS, shell exports, [native icons](../bug-fix/2026-09-11-desktop-finder-icons.md), plugin listing/RPCs with ACP and Office, offline Teams reactivation, preserved activation choices, Hub removal, rollback and old-profile migration. Devin checks use packaged Electron, synthetic CLI configuration and real MCP stdio/HTTP transports to verify fixed registration, concurrent session isolation and capability revocation without user credentials. These deterministic checks do not replace real provider login or model tests.

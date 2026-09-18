# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

English | [中文](2026-09-10-desktop-portable-distribution.zh.md)

## Problem

Internal recipients need a double-click application without separate DSH or JavaScript-tool installation. Existing Nexus registry and TLS configuration must work for additional plugins, and normal operation must not require administrator privileges.

## Decision

The desktop branch ships macOS arm64 and Windows x64 ZIPs with DSH `0.1.6-alpha.2`, ACP `0.1.6-alpha.2.0` and Office `0.1.0-beta.2`. Tag `0.1.6.alpha.2.1` maps to application SemVer `0.1.6-alpha.2.1`. Both public plugin tarballs are locked by npm integrity; Hub is absent.

Core production dependencies execute from ASAR under Electron Node mode. The official Node/Python and document-tool payload remains bundled. The native startup page appears before profile preparation and one Host serves the application. First launch copies prebuilt plugin dependencies; additional user plugins may require registry access during migration.

Seed upgrades move the complete old profile into `desktop/migration-backups/<UUID>` before changing files and restore it if preparation fails. Retired local core tarballs are recognized from their recorded inventory and exact specifications. The [native experiment decision](2026-09-13-desktop-experiment-bridge.md) owns Hub removal and Teams state migration. Sessions and workspaces are not cleared.

The [desktop README](../../../../apps/desktop/README.md#environment-and-registry) owns shell import, npmrc precedence and the exact export exclusions. The isolated desktop home, telemetry default, Edit menus, native icons and external link context actions remain. Personal shell files, credentials and profile backups are never release inputs.

CI provisions a disposable standard account on each platform. Dependency installation, compilation, ZIP creation and packaged smoke execute under that account, with assertions rejecting root or administrator membership. Administrative runner privileges are used only to create the account and grant access to the disposable checkout. The same verified archives are promoted to GitHub Release.

## Alternatives considered

Requiring system runtimes would reduce archive size but contradict offline startup requirements. Official signed installers require separate certificate infrastructure; this distribution instead uses ad-hoc macOS signing and unsigned Windows ZIPs. OS approval prompts can remain.

## Consequences

Verification covers npm TLS settings, shell exports, icons, native plugin RPCs, offline Teams changes, rollback and old-profile migration. Windows checks force file-symlink denial and verify the packaged ACP hard-link fallback against synthetic Devin configuration without reading credentials. Real provider logins and live model tests remain separate.

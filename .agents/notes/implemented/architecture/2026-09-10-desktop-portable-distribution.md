# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

English | [中文](2026-09-10-desktop-portable-distribution.zh.md)

## Problem

Internal recipients need a double-click desktop application without separately installing the harness or its JavaScript tools. They also need their existing Nexus registry and TLS configuration when installing plugins. Upstream signed releases require certificate infrastructure and use a fixed package registry.

## Decision

The `desktop` branch produces macOS arm64 and Windows x64 ZIPs with a prebuilt production core, bundled upstream Node.js, pnpm, and three pinned plugins. The backend executes under Electron’s Node mode from ASAR; package operations use the separate upstream Node executable. Core dependencies are never installed at application startup. Migration recognizes retired core packages from the previous release inventory only when their dependency specifications still match the recorded local tarballs. The startup page appears before preparation, and one backend serves both readiness and application requests.

The core includes DSH `0.1.6-alpha.1` and subsequent upstream startup optimizations. ACP adapter `0.1.6-alpha.1.6`, Plugin Hub `0.2.3`, and Agent Teams Office `0.1.0-beta.1` are built into a separate writable-profile template whose lockfile verifies their npm integrity. The requested GitHub tag `0.1.6.alpha.1.5` maps to internal SemVer `0.1.6-alpha.1.5`; dependency versions remain independent of the desktop build counter.

First launch copies the prepared plugin template without invoking pnpm. Template upgrades move the previous profile into a private migration backup, preserve user configuration and activation choices, then validate the new graph. Preparation failures restore the previous files. Bundled plugin versions follow the application release; additional user plugins retain exact versions and may require registry access during migration.

Bundled pnpm and repository tooling use `11.23.0`. Package operations read the user’s npmrc and npm environment overrides, including scoped registry credentials and TLS settings, without copying personal configuration into release resources. Application-owned package storage remains separate. macOS imports exported login-interactive-shell variables; the [desktop README](../../../../apps/desktop/README.md#environment-and-registry) owns the exact exclusions and timeout. Windows inherits its launch environment.

The fork uses a separate desktop data home by default, respects explicit home and telemetry choices, and disables telemetry and automatic updates by default. Native Edit roles restore standard shortcuts; HTTP/HTTPS links open externally and expose their address in a context menu. Both Teams bundles remain in the core while the [Hub bridge](2026-09-13-desktop-experiment-bridge.md) controls their registration.

Office uses the existing Team service and Connection transport without adding a separate server. Its prebuilt renderer and third-party notices remain in the plugin seed. Teams may be disabled while Office stays installed; packaged checks cover its enabled and disabled responses.

Packaged adapter checks simulate Windows file-symlink denial and verify its hard-link fallback, isolated MCP configuration, shared file writes, and cleanup without deleting source files. This regression uses synthetic configuration and does not exercise an authenticated Devin process.

## Alternatives considered

**Require a system runtime.** This would reduce the archive size but contradict the recipient's installation requirements. The runtime and offline seed are included instead.

**Reuse upstream signed installers.** Developer ID, notarization, and Windows EV token provisioning are outside this internal distribution. macOS uses ad-hoc signing and Windows is unsigned; operating-system approval prompts remain possible.

**Replace registry constants only.** A fixed Nexus URL cannot serve recipients with different registries, authentication, or CA settings. User npmrc handling preserves those existing configurations.

## Consequences

Archives contain platform-specific production dependencies and no personal npm configuration. Users replace the complete application for upgrades; migration backups stay local because they can contain personal settings. macOS ad-hoc signing and unsigned Windows ZIPs retain operating-system approval requirements.

Verification covers real npm TLS configuration, migration restoration, shell environment parsing, one-backend startup, packaged client modules, and offline Teams switching. Full file integrity checks run at packaging time; warm startup checks runtime identity and plugin lock state. Native Windows packaging is qualified by GitHub Actions. Live model services and external ACP logins require separate user credentials.

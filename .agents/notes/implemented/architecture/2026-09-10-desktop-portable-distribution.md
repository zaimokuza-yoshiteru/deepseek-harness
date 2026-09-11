# Agent Note: Desktop ZIP distribution with npm configuration

Status: implemented

English | [中文](2026-09-10-desktop-portable-distribution.zh.md)

## Problem

Internal recipients need a double-click desktop application without separately installing the harness or its JavaScript tools. They also need their existing Nexus registry and TLS configuration when installing plugins. Upstream signed releases require certificate infrastructure and use a fixed package registry.

## Decision

The `desktop` branch packages macOS arm64 and Windows x64 ZIPs with a local core package set, upstream Node.js, pnpm, and the exact ACP adapter release. The desktop distribution version appends a positive build counter to the pinned DSH version. The seed records both versions, and profile reconciliation compares the counter so a same-base desktop rebuild replaces backend resources.

The current distribution pins DSH `0.1.5-rc.2` at upstream commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` and ACP adapter `0.1.5-rc.2.1` from source commit `4cc5210f8c3c39c19bb7227c8e9cab27b91e331d`; seed preparation verifies the npm tarball integrity. During upgrades, seed plugin versions take precedence over previous installations of those packages. Other plugins retain their exact versions and registrations. Workspace policy is generated from each profile's recorded DSH version, so an alpha profile remains readable while the rc seed receives its own exact adapter release-age exception.

The upgrade-only add prefers local caches and trusts the verified seed lockfile. It may retrieve missing dependency metadata from the configured registry when user plugins must be re-resolved with new core packages. The frozen seed installation stays offline. Normal plugin changes retain their existing policy checks.

The bundled pnpm is pinned to `11.23.0`, which fixes the install worker shutdown hang observed during the rc.1-to-rc.2 plugin upgrade ([pnpm #12297](https://github.com/pnpm/pnpm/issues/12297)). The repository build tool uses the same version so Electron dependency collection does not encounter a package-manager version mismatch. The bundled pnpm reads the user's npmrc without copying it into resources. npm environment variables retain their public spelling; general network overrides are also mapped to pnpm 11's environment spelling. Package-manager storage remains application-owned. TLS relaxation applies to the package-manager configuration, not a process-wide Node TLS switch.

The fork defaults to a separate DSH home and Electron user-data directory. Automatic updates are absent from the menu and launch path; telemetry defaults to disabled. Explicit DSH home and telemetry settings remain supported. GitHub tag builds verify desktop-branch ancestry and attach ZIPs and checksums to a prerelease without publishing npm packages.

Runtime preparation runs before the full CI build and logs download, extraction, and copying stages. Windows Node ZIP extraction uses Electron's maintained native extractor; the previous `extract-zip` implementation exited with an unsettled top-level await on the Windows runner after checksum verification.

Agent Teams defaults are the official Host and Web bundles in that order after base and Web. Their dependency closures are copied from local release tarballs, and profile reconciliation treats both as application-owned layers. The alpha.2 and rc.1 layer prefixes remain readable during upgrades; new profiles and plugin transactions preserve the Teams prefix. The adapter release-age exception follows the adapter pin, including its extra patch counter. DSH offers no dedicated Teams toggle, so this distribution does not invent one. Plugin removal reads installed versions only after pnpm has populated the staging project.

## Alternatives considered

**Require a system runtime.** This would reduce the archive size but contradict the recipient's installation requirements. The runtime and offline seed are included instead.

**Reuse upstream signed installers.** Developer ID, notarization, and Windows EV token provisioning are outside this internal distribution. macOS uses ad-hoc signing and Windows is unsigned; operating-system approval prompts remain possible.

**Replace registry constants only.** A fixed Nexus URL cannot serve recipients with different registries, authentication, or CA settings. User npmrc handling preserves those existing configurations.

## Consequences

Application archives are larger and platform-specific. npm credentials stay on the recipient's machine. Exact adapter version and integrity checks bind the release; agent executables remain external. Users replace the whole application for desktop upgrades. Plugin compatibility with the desktop's pipe transport remains required.

Verification includes a real self-signed HTTPS registry, configuration precedence tests, a same-base build upgrade test, and a packaged-host smoke that installs from an empty home with an unreachable registry and checks adapter inventory. The smoke does not exercise live ACP agents or model services; CI owns native Windows build execution.

Smoke logs distinguish installation, host startup, asset transport, and activation. Completed ZIPs remain available when a later smoke fails, and a manual replay workflow can test those resources without rebuilding the core. A replay is diagnostic evidence; a changed product still needs a complete successful build before distribution.

On Windows, the original first-launch path spent 154 seconds preparing the store before pnpm began installing; the smoke deadline interrupted a progressing installation. A missing persistent store now adopts the verified extraction by renaming it within the desktop data root, avoiding a second copy and deletion of roughly 21,000 files. Existing stores still merge so plugin files and package-index records survive upgrades. The Windows smoke allows five minutes for this measured cold-store work plus dependency installation and host startup; macOS retains three minutes.

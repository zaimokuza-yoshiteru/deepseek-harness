# DSH Desktop portable distribution

English | [中文](README.zh.md)

## Summary

This fork ships macOS Apple Silicon and Windows x64 ZIPs with DSH `0.1.7-alpha.1`, ACP adapter `0.1.7-alpha.1.1`, and Agent Teams Office `0.1.0-beta.3`. Recipients do not install DSH, Node.js, npm, or pnpm separately. Agent executables such as Devin and Kimi remain external.

## Table of Contents

- [Open the application](#open-the-application)

- [Plugins and Teams](#plugins-and-teams)

- [Environment and registry](#environment-and-registry)

- [Data and upgrades](#data-and-upgrades)

- [Build and release](#build-and-release)

## Open the application

Extract the complete ZIP. Open `DSH Desktop.app` on macOS or `DSH Desktop.exe` on Windows. Keep the Windows executable with its adjacent files. The Mac application uses ad-hoc signing without notarization; system security approval may be required. The Windows executable is unsigned.

The window displays the native startup page while one backend starts. Core production dependencies execute from the application ASAR; startup does not install them. First launch copies the prepared plugin dependencies into the writable profile. The upstream Node/Python and document-tool payload is included and prepared under the data home as needed. Full runtime integrity checks run during packaging.

Native Edit menus provide select all, copy, paste, cut, undo, and redo. HTTP/HTTPS links open in the system browser; the link context menu can copy the original address.

## Plugins and Teams

Open **Plugins** in the application sidebar to use DSH’s native plugin manager. Choose its installation action, enter a package specification such as `@scope/plugin-name@version`, review the package, and install it. Plugins must support DSH `0.1.7-alpha.1`. The native manager owns package installation, removal and activation, and reports any required reload or blocked operation. Plugin Hub and its desktop IPC bridge are not included.

Agent Teams is enabled for a new profile. The native manager exposes one official Agent Teams bundle containing Host and Web modules. Disable or enable that bundle to switch Teams without downloading dependencies. Migration retains the previous Host bundle selection and removes the retired separate Web bundle.

Bundled Office appears in the right sidebar of a team conversation and offers 3D and pixel views. It requires WebGL, displays up to 16 teammates and one lead, and hides its entry while Teams is disabled. Rendering libraries and license notices ship with the plugin; reopening Teams requires no Office download. Office can also be disabled independently in the plugin manager.

## Environment and registry

On macOS, each launch runs the user’s `$SHELL` (default `/bin/zsh`) with `-ilc`. The shell itself loads login and interactive startup files, including `.zprofile` and `.zshrc` for zsh. Only exported variables are imported; aliases and shell functions are not executables. The operation has an eight-second deadline and reports a startup error on failure. Windows inherits its launch environment directly.

Shell import excludes `ELECTRON_*`, `DSH_DESKTOP_*`, `NODE_OPTIONS`, `NODE_PATH`, `PWD`, `OLDPWD`, `SHLVL`, and `_`. Other exports, including credential variables, proxy settings, and `npm_config_*`, are retained. The selected desktop data home remains application-owned. Bundled Node is appended to PATH after user tools; it does not override an installed user Node. No personal shell file or environment snapshot is copied into the application.

The bundled pnpm `11.23.0` reads `~/.npmrc`, or the file selected by `npm_config_userconfig`, including scoped registries, authentication, CA certificates, and `strict-ssl=false`. `npm_config_registry` and `npm_config_strict_ssl` override file settings. No system npm is required. TLS relaxation is scoped to package operations; package storage follows pnpm configuration.

## Data and upgrades

The default data home is `~/.dsh-desktop`; explicit `DSH_HOME` is respected. Electron data is under `electron-user-data` and plugin files under `profiles/desktop`. Telemetry defaults to disabled. Replace the complete application to upgrade; this distribution does not automatically update or publish npm packages.

Plugin-template upgrades retain a complete profile backup under `desktop/migration-backups/<UUID>`, preserve Teams and other plugin activation choices, and pin ACP and Office to this release. The retired Hub dependency and bundle selection are removed from the active profile; its old files remain in the backup. Additional user plugins retain their versions and may require the configured registry during migration. Preparation failure restores the previous profile. Retired core tarballs are recognized using the previous release inventory and exact local dependency specifications. Keep backups locally because they can contain personal configuration. Sessions and workspaces are not deleted.

## Build and release

Build on the matching operating system using the repository’s locked dependencies:

```sh

pnpm install --frozen-lockfile

pnpm --dir apps/desktop run package:portable:mac:arm64

```

The Windows command is `pnpm --dir apps/desktop run package:portable:win:x64`. GitHub Actions provisions a temporary standard account, then installs dependencies, builds and checks the final application without administrator membership. Only account provisioning uses the runner’s administrative privileges. Checks cover native plugin management, ACP/Office RPCs, offline Teams toggles, profile migration and Devin’s fixed stdio MCP entry and isolated session capabilities. Build outputs, diagnostics, profiles, signing materials, and credentials stay outside Git history. Tag `0.1.7.alpha.1.1` maps to application SemVer `0.1.7-alpha.1.1`; core packages keep `0.1.7-alpha.1`.

The **Desktop portable smoke replay** workflow accepts a previous build run ID. On Windows it extracts that exact ZIP, verifies an ordinary-user identity, and times a fresh-profile GUI launch and a complete relaunch with the same profile. Read `result.json` and screenshots in the `desktop-startup-win-x64` artifact: readiness requires a visible Settings button and a successfully opened Settings dialog. The report records the ZIP SHA256 and renderer paint timings. ZIP extraction, user-machine security scanning and OS cold-cache behavior are not represented by the launch timings. The macOS replay retains its backend checks.

## Release versions

Portable tags use `0.1.7.alpha.1.<counter>` and application metadata uses `0.1.7-alpha.1.<counter>`. Core and plugin versions remain separately pinned. Standard upstream installer commands derive their versions from the package manifests.

## Windows EV signing

Portable ZIPs are unsigned and need no EV token. Upstream signed-installer scripts remain available for separate certificate-managed distribution; their signing preflight does not run in the portable workflow.

## Dev Note

See the [portable distribution decision](../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.md) and [native experiment management](../../.agents/notes/implemented/architecture/2026-09-13-desktop-experiment-bridge.md). Runtime and user-plugin dependency graphs remain separate; the renderer has no Node integration.

The desktop build bundles the native account stream protocol into the main-process entry, so application launch does not depend on a separate workspace package or its peer installation.

## Upload updates

Portable builds use [GitHub Release promotion](../../.github/workflows/desktop-promote.yml) to publish the verified CI ZIPs and SHA256 checksums. They do not upload to the upstream automatic-update service.

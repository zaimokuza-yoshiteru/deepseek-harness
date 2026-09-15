# DSH Desktop portable distribution

English | [中文](README.zh.md)

## Summary

This fork ships macOS Apple Silicon and Windows x64 ZIPs with DSH `0.1.6-alpha.1`, ACP adapter `0.1.6-alpha.1.3`, and Plugin Hub `0.2.3`. The core includes upstream startup optimizations after that release. Recipients do not install DSH, Node.js, npm, or pnpm separately. Agent executables such as Devin and Kimi remain external.

## Table of Contents

- [Open the application](#open-the-application)

- [Plugins and Teams](#plugins-and-teams)

- [Environment and registry](#environment-and-registry)

- [Data and upgrades](#data-and-upgrades)

- [Build and release](#build-and-release)

## Open the application

Extract the complete ZIP. Open `DSH Desktop.app` on macOS or `DSH Desktop.exe` on Windows. Keep the Windows executable with its adjacent files. The Mac application uses ad-hoc signing without notarization; system security approval may be required. The Windows executable is unsigned.

The window displays a startup page while one backend starts. Core production dependencies execute from the application ASAR; startup does not install them. First launch copies only the prepared plugin dependencies into the writable profile. Full runtime integrity checks run during packaging. Subsequent launches compare runtime and plugin-lock identities.

Native Edit menu roles provide select all, copy, paste, cut, undo, and redo. HTTP/HTTPS links open in the system browser; a link context menu shows and copies the original address.

## Plugins and Teams

Open **Desktop Plugins…** from the application menu, or press `Cmd+,` on macOS and `Ctrl+,` on Windows. Enter a registry package specification in the form `@scope/plugin-name@version` and select **Install**. The package must support the current DSH desktop dependency contract; for example, theme-library `0.2.1` needs an upstream peer-dependency declaration fix before it can be installed. The installed list offers enable, disable, update, and remove. Package changes restart the backend; finish active work first. A failed package change remains available for repair through this window.

Agent Teams is enabled for a new profile. Use Plugin Hub’s experimental features page to turn it off or on. Both official Teams layers change together; their dependencies remain bundled, so switching requires no download or installation. The desktop refuses switching while agents or API requests are active, then restarts the backend before acknowledging a successful change.

## Environment and registry

On macOS, each launch runs the user’s `$SHELL` (default `/bin/zsh`) with `-ilc`. The shell itself loads login and interactive startup files, including `.zprofile` and `.zshrc` for zsh. Only exported variables are imported; aliases and shell functions are not executables. The operation has an eight-second deadline and reports a startup error on failure. Windows inherits its launch environment directly.

Shell import excludes `ELECTRON_*`, `DSH_DESKTOP_*`, `NODE_OPTIONS`, `NODE_PATH`, `PWD`, `OLDPWD`, `SHLVL`, and `_`. Other exports, including credential variables, proxy settings, and `npm_config_*`, are retained. The selected desktop data home remains application-owned. Bundled Node is appended to PATH after user tools; it does not override an installed user Node. No personal shell file or environment snapshot is copied into the application.

The bundled pnpm `11.23.0` reads `~/.npmrc`, or the file selected by `npm_config_userconfig`, including scoped registries, authentication, CA certificates, and `strict-ssl=false`. `npm_config_registry` and `npm_config_strict_ssl` override file settings. No system npm is required. Package-manager storage stays under the desktop data home; TLS relaxation is scoped to package operations.

## Data and upgrades

The default data home is `~/.dsh-desktop`; explicit `DSH_HOME` is respected. Electron data is under `electron-user-data`, plugin files under `profiles/desktop`, and package-manager state under `desktop/pnpm`. Telemetry defaults to disabled. Replace the complete application to upgrade; this distribution does not automatically update or publish npm packages.

Plugin-template upgrades retain a backup under `desktop/migration-backups`, preserve Teams and plugin activation choices, and pin the two bundled plugins to this release. Additional user plugins keep their versions and may require the configured registry during migration. Preparation failure restores the previous profile. Retired core tarballs are removed using the previous release inventory and exact local dependency specifications, even when the new runtime no longer includes those packages. Keep migration backups locally; they can contain personal configuration. Sessions and workspaces are not deleted by this migration.

## Build and release

Build on the matching operating system using the repository’s locked dependencies:

```sh

pnpm install --frozen-lockfile

pnpm --dir apps/desktop run package:portable:mac:arm64

```

The Windows command is `pnpm --dir apps/desktop run package:portable:win:x64`. GitHub Actions owns both platform builds and packaged offline smoke tests. These tests verify the packaged plugin dependencies, Host and Remote RPC metadata registration, and actual ACP and Plugin Hub requests in addition to core startup. Build outputs, diagnostics, local profiles, signing materials, and npm credentials stay outside Git history. The tag `0.1.6.alpha.1.2` maps to the application’s valid SemVer `0.1.6-alpha.1.2`; core packages keep version `0.1.6-alpha.1`.

## Dev Note

See the [portable distribution decision](../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.md) and [experiment bridge](../../.agents/notes/implemented/architecture/2026-09-13-desktop-experiment-bridge.md). Runtime and user-plugin dependency graphs remain separate; the renderer has no Node integration.

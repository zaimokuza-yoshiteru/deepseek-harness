# DSH Desktop portable distribution

English | [中文](desktop-portable.zh.md)

## Summary

This branch targets macOS Apple Silicon and Windows x64 ZIPs with DSH `0.1.7-rc.2`, ACP adapter `0.1.7-rc.2.0`, and Agent Teams Office `0.1.0-beta.6`. Recipients do not install DSH, Node.js, npm, or pnpm separately. Agent executables such as Devin and Kimi remain external.

## Table of Contents

- [Open the application](#open-the-application)

- [Plugins and Teams](#plugins-and-teams)

- [Environment and registry](#environment-and-registry)

- [Data and upgrades](#data-and-upgrades)

- [Build and release](#build-and-release)

## Open the application

Extract the complete ZIP. Open `DSH Desktop.app` on macOS or `DSH Desktop.exe` on Windows. Keep the Windows executable with its adjacent files. The Mac application uses ad-hoc signing without notarization; system security approval may be required. The Windows executable is unsigned.

On Windows, use a shallow extraction directory such as `C:\DSH`. A single safe path-length limit has not been established for native Office conversion. If document conversion fails after extraction into a deep directory, close the application, move the complete extracted folder to a shorter path, and reopen it. The data home and profiles remain in place.

The window displays the native startup page while one backend starts. Core production dependencies execute from the application ASAR; startup does not install them. First launch copies the prepared plugin dependencies into the writable profile. The upstream Node/Python and document-tool payload is included and prepared under the data home as needed. The Office CLI, selected native engine and their dependency closure are unpacked from ASAR for bundled Node execution. CI extracts the release ZIP, verifies its complete runtime inventory, converts DOCX, XLSX and PPTX, and executes the skill CLI with an empty PATH. Release promotion checks the ZIP against the SHA256 recorded by that successful smoke test.

Native Edit menus provide select all, copy, paste, cut, undo, and redo. Chat links follow the native “Open chat links in” setting. New-window HTTP/HTTPS links open in the system browser; the link context menu can open or copy the original address.

## Plugins and Teams

Open **Plugins** in the application sidebar to use DSH’s native plugin manager. Choose its installation action, enter a package specification such as `@scope/plugin-name@version`, review the package, and install it. Plugins must support DSH `0.1.7-rc.2`. The native manager owns package installation, removal and activation, and reports any required reload or blocked operation. Plugin Hub and its desktop IPC bridge are not included.

Agent Teams is enabled for a new profile. The native manager exposes one official Agent Teams bundle containing Host and Web modules. Disable or enable that bundle to switch Teams without downloading dependencies. Migration retains the previous Host bundle selection and removes the retired separate Web bundle.

Bundled Office appears in the right sidebar of a team conversation and offers 3D and pixel views. It requires WebGL, displays up to 16 teammates and one lead, and hides its entry while Teams is disabled. Rendering libraries and license notices ship with the plugin; reopening Teams requires no Office download. Office can also be disabled independently in the plugin manager.

## Environment and registry

On macOS, each launch runs the user’s `$SHELL` (default `/bin/zsh`) with `-ilc`. The shell itself loads login and interactive startup files, including `.zprofile` and `.zshrc` for zsh. Only exported variables are imported; aliases and shell functions are not executables. The operation has an eight-second deadline and reports a startup error on failure. Windows inherits its launch environment directly.

Shell import excludes `ELECTRON_*`, `DSH_DESKTOP_*`, `NODE_OPTIONS`, `NODE_PATH`, `PWD`, `OLDPWD`, `SHLVL`, and `_`. Other exports, including credential variables, proxy settings, and `npm_config_*`, are retained. The selected desktop data home remains application-owned. Bundled Node is appended to PATH after user tools; it does not override an installed user Node. No personal shell file or environment snapshot is copied into the application.

The bundled pnpm `11.23.0` reads `~/.npmrc`, or the file selected by `npm_config_userconfig`, including scoped registries, authentication, CA certificates, and `strict-ssl=false`. `npm_config_registry` and `npm_config_strict_ssl` override file settings. No system npm is required. TLS relaxation is scoped to package operations; package storage follows pnpm configuration.

## Data and upgrades

Fatal startup reports retain the ten most recent files in Electron’s logs directory: `~/Library/Logs/DSH Desktop` on macOS and `electron-user-data/logs` under the data home on Windows. Reports can contain error and renderer diagnostics; inspect them before sharing. Plugin bundle responses use `no-store` to avoid retaining obsolete per-launch bundles in Chromium’s disk cache.

The default data home is `~/.dsh-desktop`; explicit `DSH_HOME` is respected. Electron data is under `electron-user-data` and plugin files under `profiles/desktop`. Telemetry defaults to disabled. Replace the complete application to upgrade; this distribution does not automatically update or publish npm packages.

Plugin-template upgrades retain a complete profile backup under `desktop/migration-backups/<UUID>`, preserve Teams and other plugin activation choices, and pin ACP and Office to this release. The retired Hub dependency and bundle selection are removed from the active profile; its old files remain in the backup. Additional user plugins retain their versions and may require the configured registry during migration. Preparation failure restores the previous profile. Retired core tarballs are recognized using the previous release inventory and exact local dependency specifications. Keep backups locally because they can contain personal configuration. Sessions and workspaces are not deleted.

## Build and release

Build on the matching operating system using the repository’s locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/desktop run package:portable:mac:arm64
```

The Windows command is `pnpm --dir apps/desktop run package:portable:win:x64`. GitHub Actions installs dependencies, builds and checks the final application without administrator membership. Windows uses a temporary standard account. macOS retains the runner’s desktop login session, removes its administrator membership for the build and GUI checks, and restores membership afterward; a newly created account without a desktop login crashes the native document converter. Only account provisioning and restoration use administrative privileges. Checks cover native plugin management, ACP/Office RPCs, offline Teams toggles, profile migration and Devin’s fixed stdio MCP entry and isolated session capabilities. Build outputs, diagnostics, profiles, signing materials, and credentials stay outside Git history. Tag `0.1.7.rc.2.1` maps to application SemVer `0.1.7-rc.2.1`; core packages keep `0.1.7-rc.2`.

The **Desktop portable smoke replay** workflow accepts a previous build run ID. On Windows it extracts that exact ZIP, verifies an ordinary-user identity, and times a fresh-profile GUI launch and a complete relaunch with the same profile. Read `result.json` and screenshots in the `desktop-startup-win-x64` artifact: readiness requires a visible account menu and a successfully opened Settings dialog. The macOS build also runs this GUI check under its standard-user identity. The report records the ZIP SHA256 and renderer paint timings. ZIP extraction, user-machine security scanning and OS cold-cache behavior are not represented by the launch timings. The macOS replay retains its backend checks.

Portable tags use `0.1.7.rc.2.<counter>` and application metadata uses `0.1.7-rc.2.<counter>`. Core and plugin versions remain separately pinned. Standard upstream installer commands derive their versions from the package manifests.

Portable ZIPs are unsigned and need no EV token. Upstream signed-installer scripts remain available for separate certificate-managed distribution; their signing preflight does not run in the portable workflow.

The desktop shell includes API Gateway and its Cordis peer as production dependencies using the upstream package layout. They are installed during the build and load locally at application launch. Portable macOS builds ad-hoc sign the document conversion helper with the upstream JIT entitlement before recording its runtime hashes; no developer certificate or administrator account is required.

Portable builds use [GitHub Release promotion](../../../.github/workflows/desktop-promote.yml) to publish the verified CI ZIPs and SHA256 checksums. They do not upload to the upstream automatic-update service.

## Dev Note

See the [portable distribution and native plugin management decision](../../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.md). Runtime and user-plugin dependency graphs remain separate; the renderer has no Node integration.

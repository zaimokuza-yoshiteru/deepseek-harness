# DSH Desktop

English | [中文](README.zh.md)

This fork distributes an Electron application with DSH `0.1.5-rc.2`, `@zaimokuza/dsh-acp-adapter` `0.1.5-rc.2.1`, upstream Node.js `24.17.0`, pnpm `11.23.0`, and an offline installation seed. Users do not install DSH, Node.js, npm, or pnpm separately. ACP agent executables are configured separately; they are not included.

## Download and open

Download the application ZIP from the fork's GitHub Release assets. GitHub's automatic source archives contain source code, not the application. Extract the entire ZIP, then open `DSH Desktop.app` on macOS Apple Silicon or `DSH Desktop.exe` on Windows x64. Keep the Windows executable and its accompanying files together. Intel Macs are not a distribution target.

The Mac application uses ad-hoc signing without Apple notarization; the Windows application is unsigned. Operating-system or company application policies can require approval before first opening. These packages do not guarantee a prompt-free launch.

Both applications use the DeepSeek whale from the repository's Web favicon, rendered in blue on a white rounded background. [The desktop SVG](assets/icon.svg) supplies the checked-in [macOS ICNS](assets/icon.icns) and [Windows ICO](assets/icon.ico), generated with the corrected `icons@1.2.3` tool. Packaging uses these files directly; small Finder icons use ARGB encoding. Windows embeds the icon and version metadata while keeping code signing disabled. The [icon integrity record](assets/icon-integrity.json) pins the source, generated files, and tool archive; regenerate both native files and update the record when changing the SVG.

The first launch installs the packaged seed offline into a separate writable profile and verifies that the backend boots. It adopts the extracted store directly when no desktop store exists; upgrades merge into the existing store to preserve downloaded plugins. Model requests and configured ACP agents can still require network access. No automatic desktop update runs; replace the application with a newer release ZIP while it is closed.

## Data and plugins

Agent Teams is enabled by default through the official [Host layer](../../packages/experimental/agent-team-profile/README.md) and [Web layer](../../packages/experimental/agent-team-web-profile/README.md). Open **Desktop Plugins** with `Cmd+,` on macOS or `Ctrl+,` on Windows, then use **Built-in features → Agent Teams** to switch both layers together. Switching restarts the backend and reloads the main window; wait for running tasks and requests to finish first. The setting survives application restarts and upgrades. Dependencies remain installed, so re-enabling works offline. Sessions and Teams data are retained. ACP adapter and user-installed plugins remain in the installed list. Profiles without a saved choice default to enabled. Teams remains experimental; its upstream Web layer documents limitations with preset-scoped legacy child controls.

On an application upgrade, bundled plugins take the versions shipped in the new seed; the previous ACP adapter cannot replace the new bundled version. Other installed plugins retain their exact versions and remain enabled. The staged backend must pass its startup check before the replacement becomes active.

The native **Edit** menu supplies standard editing shortcuts for the focused window, including the chat input and plugin-manager fields. On macOS, use `Cmd+A/C/V/X` to select all, copy, paste, or cut, `Cmd+Z` to undo, and `Cmd+Shift+Z` to redo.

By default, product data lives under `~/.dsh-desktop` on macOS or `%USERPROFILE%\.dsh-desktop` on Windows. The desktop profile is `profiles/desktop`, package state is `desktop/pnpm`, and Electron state is `electron-user-data` below that home. An explicit `DSH_HOME` overrides this root. The application does not import an existing Web profile. Telemetry defaults to `DSH_TELEMETRY_MODE=DISABLED`; explicit launch configuration can override it.

Open the application menu's plugin manager (or press `Cmd+,` / `Ctrl+,`) to install by npm package name, update to a version, or remove a plugin. This is an installed-plugin manager, not a searchable marketplace. The adapter is preinstalled and appears in this list. Third-party plugins must support the desktop host.

The backend runs in the bundled upstream Node.js process. `dsh-app://` and framed byte pipes carry frontend assets, Fetch requests, and streaming responses; desktop does not open a listening Web port. Package changes use a staging profile, backend health check, activation journal, and rollback. A desktop build counter change reconciles the packaged backend even when the DSH dependency version stays fixed.

### Install a plugin from the desktop window

1. Open the packaged application and wait for the main window. The source development launcher disables package changes.
2. Press `Cmd+,` on macOS or `Ctrl+,` on Windows to open the separate **Desktop Plugins** window. This is different from the plugin settings page inside the main window.
3. Enter the complete npm package spec in **npm package**. For the theme-library test, enter exactly:

```text
@zaimokuza/dsh-theme-library@0.2.1
```

4. Click **Install** and wait until the operation completes. Desktop uses its bundled pnpm, reads your npm configuration, checks the staged backend, and reloads the main window after activation. Do not enter a GitHub release URL, `npm install`, or a shell command in this field.
5. Confirm that the package name and version appear under **Installed**. **Update** asks for a target version; **Remove** uninstalls that plugin. Installation errors appear in the window, and a failed transaction preserves the previous active profile.

The theme-library `0.2.1` test on the `0.1.5-alpha.2` desktop baseline confirmed registry installation, backend restart, installed-package inventory, and the theme selector under **Settings → General**. Its animated backgrounds are not compatible with this desktop host: the plugin serves images through `webServer`, which the desktop composition disables. The image request receives the frontend HTML fallback instead of image bytes. Installation success therefore does not certify this version's visual effects. The theme plugin is a manual verification example and is not part of the distributed seed.

Upgrades that retain additional user-installed plugins prefer local caches and may contact the configured registry for missing dependency metadata. The bundled-only installation remains offline.

## npm registry and TLS configuration

Desktop passes the user configuration file to its bundled pnpm. It reads `~/.npmrc` (Windows: `%USERPROFILE%\.npmrc`) unless `NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` selects another file. npm configuration environment variables override file values, with lowercase winning if both spellings are present. No system npm executable is invoked. The configuration file is read, not modified or bundled into the application.

Example user `.npmrc`:

```ini
registry=https://nexus.example/repository/npm-group/
strict-ssl=false
@company:registry=https://nexus.example/repository/npm-private/
```

`strict-ssl=false` disables certificate validation for package-manager requests only. Prefer `cafile=/absolute/path/company-ca.pem` with validation enabled when the company CA is available. Authentication and scoped registries use pnpm's npmrc handling; keep credentials in the user's local configuration. Finder-launched apps should use the file because terminal exports need not be inherited.

The desktop still owns its store, project layout, and installation transactions. Project `.npmrc` files in the user's coding workspace are not imported: plugin operations run in the desktop profile. With no registry override, pnpm uses its public default. Model APIs, ACP subprocesses, and desktop Web requests do not inherit npm's `strict-ssl` setting. Build-time seed preparation reads the same npm configuration, but Electron and Node.js binary downloads use their own download mechanisms.

## Build and release

Build from the `desktop` branch on the matching native platform with the repository's Node/pnpm prerequisites installed:

```sh
pnpm install --frozen-lockfile
# macOS Apple Silicon
pnpm --dir apps/desktop run package:portable:mac:arm64
# Windows x64
pnpm --dir apps/desktop run package:portable:win:x64
```

The output ZIP is under `apps/desktop/.desktop-build/targets/<mac-arm64|win-x64>/artifacts`. Local builds default to desktop version `0.1.5-rc.2.2`; set `DSH_DESKTOP_DISTRIBUTION_VERSION` to choose another positive build counter. DSH and adapter dependencies retain their exact base versions. The adapter's npm tarball integrity is checked during seed preparation. The seed includes dependency bytes, lockfile, local core packages, licenses, and an integrity inventory; packaging proves an offline installation before shipping it.

Push the branch before tagging a reviewed commit:

```sh
git switch desktop
git push -u origin desktop
git tag 0.1.5-rc.2.2
git push origin 0.1.5-rc.2.2
```

The `Desktop portable` workflow verifies that the tag commit is on `origin/desktop`, builds macOS arm64 and Windows x64 independently, runs the packaged offline-host smoke, and attaches both ZIPs and `SHA256SUMS.txt` to a prerelease. Subsequent desktop revisions use `.2`, `.3`, and so on. The workflow does not publish npm packages. Branch pushes and manual workflow runs only upload Actions artifacts. A tag by itself contains no binaries until the workflow completes successfully.

Developer ID, Apple notarization, Windows EV tokens, and the upstream COS updater are not used by the portable commands. The original signed packaging commands remain available for separately configured deployments; their requirements are documented in the [upstream packaging decision](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md).

## Verification

Focused tests cover real npmrc registry/TLS requests, environment precedence, isolated data paths, build counters, plugin transactions, and target selection. `pnpm exec tsx apps/desktop/scripts/smoke-portable.ts mac-arm64` (or `win-x64`) boots the packaged backend from a fresh temporary home using an unreachable registry, checks the frontend asset, and verifies the exact installed adapter version. It does not test a live model or ACP agent. The [fork distribution decision](../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.md) records the tradeoffs.

For diagnosis, append an application ZIP path to that smoke command, or run **Desktop portable smoke replay** in Actions with the original build run ID and platform. ZIPs are extracted into disposable directories. Failed build runs retain completed ZIPs for diagnosis; require the complete build and smoke to pass before distributing them. Replay uses the selected source revision's test driver and the downloaded application's resources, so product changes still require a full rebuild before shipment.

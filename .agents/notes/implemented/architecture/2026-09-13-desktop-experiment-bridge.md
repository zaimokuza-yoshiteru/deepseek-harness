# Agent Note: Desktop experiments managed through Plugin Hub

Status: implemented

English | [中文](2026-09-13-desktop-experiment-bridge.zh.md)

## Problem

Plugin Hub supplies a common resource-management page for Web and Desktop, but the desktop profile owner runs in Electron. A renderer that writes profile files cannot coordinate idle shutdown, staged activation or rollback. Exposing package-management IPC to the application would grant more authority than experimental feature controls require.

## Decision

The application preload exposes `window.dshDesktop.experiments` with version `1`, `list()` and `setEnabled(change)`. Only the current main window's top-level `dsh-app://app` frame can invoke these handlers. The management window retains package operations but has neither experiment methods nor a Teams switch. Application scripts share this experiment authority; the bridge does not authenticate individual plugins.

The current feature allowlist contains only `agent-teams`. Each mutation includes the canonical profile returned by the host, desired `enabled` state and observed `expectedEnabled` state. The host treats the profile as an equality token, rejects stale state, and never accepts a renderer-selected filesystem destination. An unsupported release or source development launcher advertises no manageable experiments.

The host reports configured `enabled`, observed backend `activeEnabled`, installation, toggle capability and busy state separately. `activeEnabled: null` means no confirmed running state. The [offline Teams transaction](2026-09-11-desktop-agent-teams-switch.md) owns the shared mutation lock, idle shutdown, offline staging and recovery. A successful reply arrives after backend recovery and requests a renderer reload; Hub reloads after receiving that reply. Failures return stable error codes and preserve the page so Hub can report the error and read recovery state.

Each sandboxed preload is bundled independently. Its built artifact can require Electron but cannot require a shared local chunk. The desktop build executes both artifacts with a restricted loader to verify this requirement.

Host pipe teardown destroys each Node stream and awaits its close event. Stream destruction closes its descriptor even with `autoClose: false`; a separate descriptor close would race that cleanup. Release smoke checks reject nonzero child exits and exercise offline disable/reactivation with the packaged backend.

## Alternatives considered

**Write the Desktop profile from Hub.** This bypasses Electron's transaction ownership and cannot safely synchronize backend shutdown or rollback.

**Expose the whole management preload.** Package installation and removal are unnecessary permissions for a Teams switch. Separate preload APIs retain the window-specific permission split.

**Keep parallel native and Hub controls.** Two entry points duplicate UI and state handling. Hub owns the experiment interface; the native window remains the package manager. An older Hub needs an update before it can operate this bridge.

## Consequences

Web continues to manage native CLI profiles without upstream source changes. Desktop requires this fork's preload and IPC adapter, while preserving its existing transaction implementation. Additional feature IDs require an explicit host implementation; arbitrary package names and executable callbacks are not accepted.

Focused tests cover sender rejection, stale requests, busy refusal, successful restart acknowledgement, recovery failure and unknown runtime state, plus English/Chinese package-manager output without a Teams switch. Built-preload verification exercises the restricted loader. Native Electron window interaction and packaged macOS/Windows distribution remain release-level verification.

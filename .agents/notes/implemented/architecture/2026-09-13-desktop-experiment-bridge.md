# Agent Note: Native desktop experiment management

Status: implemented

English | [中文](2026-09-13-desktop-experiment-bridge.zh.md)

## Problem

DSH alpha.2 supplies native bundle management. Retaining a Hub-specific Electron experiment bridge would duplicate state ownership and keep the retired Hub on the upgrade path.

## Decision

The portable application uses DSH’s native plugin manager. It exposes no Hub experiment IPC, preload API, private idle-shutdown protocol or separate package-manager window. Native profile operations own bundle activation and runtime reloads. The [Teams note](2026-09-11-desktop-agent-teams-switch.md) defines the retained offline behavior.

Seed migration removes Hub from active dependencies and bundle selections after moving the complete previous profile to a private backup. Other user plugins, configuration and sessions remain intact. The native manager keeps its own concurrency and error handling; Electron retains upstream process shutdown and recovery.

## Alternatives considered

Keeping both native and Hub controls would retain an obsolete authority and risk divergent activation state. The fork instead removes the dedicated bridge and validates native management against the packaged plugins.

## Consequences

The renderer remains sandboxed without Node integration. Packaged verification exercises native bundle listing and offline Teams changes with ACP and Office installed, alongside profile migration and Devin MCP registration and session isolation. Real model-provider tests remain separate from these deterministic distribution checks.

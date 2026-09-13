# Agent Note: Offline desktop Agent Teams switch

Status: implemented

English | [中文](2026-09-11-desktop-agent-teams-switch.zh.md)

## Problem

Internal desktop users need to disable experimental Teams and restore it without registry access. Removing npm packages would make restoration depend on downloads and could leave the Host and Web layers inconsistent.

## Decision

Plugin Hub exposes one localized Teams switch through the [Desktop experiment bridge](2026-09-13-desktop-experiment-bridge.md). Both official bundle registrations change together; package dependencies and cached bytes remain present. The profile manifest records the choice as `dsh.desktop.agentTeams`. An absent choice retains the release default, while an explicit choice survives restarts and seed upgrades. This partially supersedes the fixed-enable decision in the [portable distribution note](2026-09-10-desktop-portable-distribution.md); its runtime, registry, packaging, and data-location decisions remain active.

Switching uses the existing staged profile transaction, an offline frozen install, backend health check, activation journal, and rollback. Electron serializes feature and plugin mutations. The Host advertises idle-restart support and checks both live agents and in-flight API responses before accepting shutdown in the same event-loop turn. Busy work refuses the change; older Hosts without this capability require an application update. The main window reloads after a successful switch. Session and Teams storage is not deleted.

## Alternatives considered

**Expose two removable plugins.** Independent removal can hide the panel while retaining team tools, and reinstalling can require a registry. The single switch preserves both layers and their dependencies.

**Change only the visible panel.** This would leave model-facing team tools active, contradicting the meaning of disabling Teams.

## Consequences

The application size does not shrink when Teams is disabled. Re-enabling needs local installation and a backend restart, but no package download. A new desktop build counter is required to deliver the Host's idle-restart capability to existing profiles.

Focused tests cover the experiment bridge, package-manager output, refusal recovery, idle checks during agent and API work, offline transactions, rollback, plugin preservation, and upgrade persistence. Packaged-runtime verification covers actual Host startup and Teams client registration in both states. Native Windows execution remains owned by the release workflow; no live model call is required by these checks.

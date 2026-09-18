# Agent Note: Offline desktop Agent Teams selection

Status: implemented

English | [中文](2026-09-11-desktop-agent-teams-switch.zh.md)

## Problem

Desktop users need to disable Teams and restore it without downloading dependencies. Profile upgrades must preserve their choice even after the Hub control is retired.

## Decision

Both official Teams bundles remain inside the production runtime. New portable profiles select both. DSH’s native plugin manager lists the Host and Web bundles separately; disabling both removes Teams execution and presentation, while retaining their installed bytes.

Migration converts the old `dsh.desktop.agentTeams` selection to native `dsh.profile.bundles`, then removes that legacy field. An explicit old false disables both; otherwise existing bundle selections survive independently. Later seed upgrades read only native selections, so a retired flag cannot re-enable a user-disabled bundle.

## Alternatives considered

A fork-specific combined toggle would duplicate the official interface and require another lifecycle bridge. The distribution follows native behavior and documents that complete Teams shutdown requires disabling both bundles.

## Consequences

Toggling does not reduce application size or invoke a package download. Office remains installed and reports disabled Teams through its native service lookup. Migration and actual packaged RPC checks cover retained activation choices, offline reactivation and removal of the obsolete Hub dependency.

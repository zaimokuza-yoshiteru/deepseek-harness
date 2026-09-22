# Agent Note: Offline desktop Agent Teams selection

Status: implemented

English | [中文](2026-09-11-desktop-agent-teams-switch.zh.md)

## Problem

Desktop users need to disable Teams and restore it without downloading dependencies. Profile upgrades must preserve their choice even after the Hub control is retired.

## Decision

The official Teams bundle contains both Host and Web modules inside the production runtime. New portable profiles enable it. DSH’s native plugin manager controls execution and presentation together while retaining installed dependencies.

Migration converts the old `dsh.desktop.agentTeams` selection to native `dsh.profile.bundles`, then removes that legacy field. An explicit old false disables Teams; otherwise the previous Host bundle selection survives. The retired separate Web bundle is removed. Later seed upgrades read only native selections, so a retired flag cannot re-enable a user-disabled bundle.

## Alternatives considered

A fork-specific combined toggle would duplicate the official interface and require another lifecycle bridge. The distribution follows the native combined bundle without a private control.

## Consequences

Toggling does not reduce application size or invoke a package download. Office remains installed and reports disabled Teams through its native service lookup. Migration and actual packaged RPC checks cover retained activation choices, offline reactivation and removal of the obsolete Hub dependency.

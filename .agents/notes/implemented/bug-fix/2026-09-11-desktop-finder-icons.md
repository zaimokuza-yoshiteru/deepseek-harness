# Agent Note: Native desktop icons with valid small macOS frames

Status: implemented

English | [中文](2026-09-11-desktop-finder-icons.zh.md)

## Problem

Finder displays corrupt green small icons while the Dock icon remains readable. The converter bundled with electron-builder 26.15.3 writes PNG payloads into legacy small ICNS frame types and assigns incorrect Retina dimensions.

## Decision

The portable configuration packages checked-in ICNS and ICO files generated from the desktop SVG with the official `icons@1.2.3` tool. Its [upstream fix](https://github.com/electron-userland/electron-builder-binaries/blob/master/packages/icons/CHANGELOG.md) uses ARGB `ic04`/`ic05` frames and correct Retina PNG sizes. The asset integrity record pins the SVG, native outputs, and downloaded tool archive. Native inputs avoid the old builder's SVG conversion path.

## Alternatives considered

**Clear Finder caches.** Cache removal cannot correct malformed bytes inside every released application.

**Upgrade electron-builder.** This couples an icon repair to changes in signing and packaging. Explicit native assets keep the existing builder while making the corrected bytes reproducible and testable.

## Consequences

SVG edits require regenerating both native files and refreshing the integrity record. Tests verify packaging paths, digests, ICNS frame encodings and dimensions, and all seven ICO sizes. macOS ImageIO decodes all ten corrected frames, including 16px and 32px. Release verification compares the application icon to the committed asset; Windows executable-resource inspection checks the embedded ICO frames. Recipient-specific Finder caches remain outside archive-byte verification.

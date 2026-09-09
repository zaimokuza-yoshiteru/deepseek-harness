/** Immutable version identity shared by one Electron shell and its dsh seed. */

import { valid } from 'semver'
import { DESKTOP_HOST_PROTOCOL_VERSION } from './host-protocol.ts'

/** Release facts embedded in the seed and copied into the active desktop project. */
export interface DesktopRelease {
  readonly schemaVersion: 1
  /** Exact DSH dependency version. */
  readonly version: string
  /** Fork build identity; package dependencies remain pinned to version. */
  readonly distributionVersion?: string
  readonly hostProtocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly nodeVersion: string
  readonly pnpmVersion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validate release data read from an installed or packaged filesystem resource. */
export function parseDesktopRelease(value: unknown): DesktopRelease {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.version !== 'string'
    || valid(value.version) === null || value.hostProtocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION
    || typeof value.nodeVersion !== 'string' || valid(value.nodeVersion) === null
    || typeof value.pnpmVersion !== 'string' || valid(value.pnpmVersion) === null
    || (value.distributionVersion !== undefined && (typeof value.distributionVersion !== 'string'
      || !new RegExp(`^${value.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.[1-9][0-9]*$`, 'u').test(value.distributionVersion)))) {
    throw new Error('dsh desktop: invalid desktop release metadata')
  }
  return {
    schemaVersion: 1,
    version: value.version,
    ...(typeof value.distributionVersion === 'string' ? { distributionVersion: value.distributionVersion } : {}),
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: value.nodeVersion,
    pnpmVersion: value.pnpmVersion,
  }
}

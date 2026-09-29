export interface DesktopDistributionVersion {
  tag: string
  appVersion: string
  sequence: number
}

export function deriveDesktopDistributionVersion(dshVersion: string, sequence: number): DesktopDistributionVersion
export function validateDesktopDistributionVersion(version: string, dshVersion: string): number
export function resolveDesktopDistributionVersion(
  delivery: { dshVersion: string; version: string },
  requestedVersion?: string,
): DesktopDistributionVersion

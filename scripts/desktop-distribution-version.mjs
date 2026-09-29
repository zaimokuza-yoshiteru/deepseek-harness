/** Derive and validate the portable distribution tag from delivery.json's DSH base. */
function numericIdentifier(value) {
  return value.length > 0 && [...value].every(character => character >= '0' && character <= '9')
    && (value.length === 1 || value[0] !== '0')
}

function validIdentifier(value) {
  return value.length > 0 && [...value].every(character =>
    (character >= '0' && character <= '9') || (character >= 'A' && character <= 'Z')
      || (character >= 'a' && character <= 'z') || character === '-')
}

function parseDshVersion(dshVersion) {
  if (typeof dshVersion !== 'string') throw new TypeError('delivery.dshVersion must be a string')
  const prereleaseStart = dshVersion.indexOf('-')
  const coreText = prereleaseStart < 0 ? dshVersion : dshVersion.slice(0, prereleaseStart)
  const prerelease = prereleaseStart < 0 ? undefined : dshVersion.slice(prereleaseStart + 1)
  const core = coreText.split('.')
  if (core.length !== 3 || !core.every(numericIdentifier)) throw new Error(`Invalid delivery.dshVersion: ${dshVersion}`)
  if (prerelease !== undefined) {
    const identifiers = prerelease.split('.')
    if (!identifiers.every(validIdentifier)
      || identifiers.some(identifier => numericIdentifier(identifier) === false
        && [...identifier].every(character => character >= '0' && character <= '9'))) {
      throw new Error(`Invalid delivery.dshVersion: ${dshVersion}`)
    }
  }
  return {
    prefix: prerelease === undefined ? coreText : `${coreText}.${prerelease}`,
    hasPrerelease: prerelease !== undefined,
  }
}

/** Turn a DSH release and a positive sequence into the public ZIP tag and app version. */
export function deriveDesktopDistributionVersion(dshVersion, sequence) {
  const { prefix, hasPrerelease } = parseDshVersion(dshVersion)
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Distribution sequence must be a positive safe integer')
  return {
    tag: `${prefix}.${sequence}`,
    appVersion: hasPrerelease ? `${dshVersion}.${sequence}` : `${dshVersion}-desktop.${sequence}`,
    sequence,
  }
}

/** Validate a supplied or configured ZIP tag and return its sequence number. */
export function validateDesktopDistributionVersion(version, dshVersion) {
  const { prefix } = parseDshVersion(dshVersion)
  const expectedPrefix = `${prefix}.`
  if (typeof version !== 'string' || !version.startsWith(expectedPrefix)) {
    throw new Error(`Invalid desktop distribution version; expected ${expectedPrefix}<positive integer>`)
  }
  const sequenceText = version.slice(expectedPrefix.length)
  const sequence = Number(sequenceText)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== sequenceText) {
    throw new Error(`Invalid desktop distribution version; expected ${expectedPrefix}<positive integer>`)
  }
  return sequence
}

/** Resolve delivery.json's default tag or a caller-supplied override against the same DSH base. */
export function resolveDesktopDistributionVersion(delivery, requestedVersion) {
  if (!delivery || typeof delivery !== 'object') throw new TypeError('delivery configuration must be an object')
  const tag = requestedVersion ?? delivery.version
  const sequence = validateDesktopDistributionVersion(tag, delivery.dshVersion)
  const derived = deriveDesktopDistributionVersion(delivery.dshVersion, sequence)
  if (derived.tag !== tag) throw new Error(`Invalid desktop distribution version: ${tag}`)
  return derived
}

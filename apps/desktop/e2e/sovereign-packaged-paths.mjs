// Resolve packaged Hermes / Sovereign paths for sovereign desktop smoke scripts.
import fs from 'node:fs'
import path from 'node:path'

const desktop = path.resolve(import.meta.dirname, '..')

/** @returns {'mac' | 'mac-arm64' | 'win-unpacked'} */
export function packagedUnpackedDirName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return 'win-unpacked'
  return arch === 'arm64' ? 'mac-arm64' : 'mac'
}

export function packagedUnpackedRoot(platform = process.platform, arch = process.arch) {
  const override = process.env.SOVEREIGN_PACKAGED_ROOT
  if (override) return path.resolve(override)
  return path.join(desktop, 'release', packagedUnpackedDirName(platform, arch))
}

export function packagedHermesExecutable(platform = process.platform, arch = process.arch) {
  const root = packagedUnpackedRoot(platform, arch)
  if (platform === 'win32') {
    return path.join(root, 'Hermes.exe')
  }
  return path.join(root, 'Hermes.app/Contents/MacOS/Hermes')
}

export function packagedSovereignBinary(platform = process.platform, arch = process.arch) {
  const root = packagedUnpackedRoot(platform, arch)
  if (platform === 'win32') {
    return path.join(root, 'resources/sovereign/sovereign.exe')
  }
  return path.join(root, 'Hermes.app/Contents/Resources/sovereign/sovereign')
}

export function assertPackagedHermesExists(platform = process.platform, arch = process.arch) {
  const exe = packagedHermesExecutable(platform, arch)
  if (!fs.existsSync(exe)) {
    throw new Error(`Packaged Hermes missing (run pack/dist first): ${exe}`)
  }
  return exe
}

/** Minimal env for an isolated desktop sandbox (macOS + Windows). */
export function sovereignSandboxEnv(sandbox) {
  const base = {
    ...process.env,
    HERMES_HOME: path.join(sandbox, 'hermes-home'),
    JCODE_HOME: path.join(sandbox, 'jcode-home'),
    SOVEREIGN_FEATURE_IDLE_MS: process.env.SOVEREIGN_FEATURE_IDLE_MS || '1500',
  }
  if (process.platform === 'win32') {
    return {
      ...base,
      USERPROFILE: sandbox,
      APPDATA: path.join(sandbox, 'AppData/Roaming'),
      LOCALAPPDATA: path.join(sandbox, 'AppData/Local'),
      TEMP: path.join(sandbox, 'Temp'),
      TMP: path.join(sandbox, 'Temp'),
    }
  }
  return {
    ...base,
    HOME: sandbox,
    PATH: process.env.SOVEREIGN_E2E_PATH || '/usr/bin:/bin:/opt/homebrew/bin',
  }
}

import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fail packaged Windows smoke when the tray entry point was omitted or empty.
 * @param resourcesPath - Physical `resources` directory in the packaged Windows application.
 */
export function assertPackagedWindowsTrayIcon(resourcesPath: string): void {
  const trayIcon = join(resourcesPath, 'tray.ico')
  assert.ok(existsSync(trayIcon) && statSync(trayIcon).isFile() && statSync(trayIcon).size > 0,
    'Packaged Windows application is missing its tray icon')
}

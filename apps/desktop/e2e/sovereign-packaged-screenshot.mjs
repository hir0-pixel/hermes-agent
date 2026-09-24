// Capture the actual packaged Hermes UI against a local Sovereign run ledger.
// SOVEREIGN_BIN and SOVEREIGN_SCREENSHOT_HOME point at the built engine and an
// isolated JCODE_HOME containing observability.sqlite3.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = path.join(desktop, 'release/mac-arm64/Hermes.app/Contents/MacOS/Hermes')
const sovereign = process.env.SOVEREIGN_BIN
const ledger = process.env.SOVEREIGN_SCREENSHOT_HOME
const output = process.env.SOVEREIGN_SCREENSHOT_OUTPUT || path.join(desktop, 'release/sovereign-observability')
if (!sovereign || !ledger) throw new Error('Set SOVEREIGN_BIN and SOVEREIGN_SCREENSHOT_HOME')
fs.mkdirSync(output, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-desktop-'))
const wrapper = path.join(sandbox, 'hermes')
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(sovereign)} --provider ollama --model qwen3.8:27b "$@"\n`, { mode: 0o700 })
const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
  env: { ...process.env, HERMES_DESKTOP_HERMES: wrapper, HERMES_HOME: path.join(sandbox, 'hermes-home'), JCODE_HOME: ledger }
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => { window.location.hash = '#/agents' })
  await page.getByRole('button', { name: 'History' }).waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByText('Run history').waitFor({ timeout: 30_000 })
  await page.getByText('Timeline').waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: /Run complete/ }).first().click()
  await page.getByText('Model call').first().waitFor({ timeout: 30_000 })
  for (const [name, width, height] of [['wide', 1220, 800], ['narrow', 720, 680]]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.unmaximize()
      window?.setMinimumSize(400, 400)
      window?.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    }, { width, height })
    await page.waitForTimeout(500)
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
    console.log(name, viewport)
    await page.screenshot({ path: path.join(output, `observability-${name}.png`), clip: { x: 0, y: 0, width: Math.min(width, viewport.width), height: Math.min(height, viewport.height) }, animations: 'disabled' })
  }
  await page.getByRole('button', { name: 'Live' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByText('Run history').waitFor()
  console.log(output)
} finally {
  await app.close()
}

// Packaged-app chat + tool approval against local Ollama.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = path.join(desktop, 'release/mac-arm64/Hermes.app/Contents/MacOS/Hermes')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-chat-'))
const workspace = path.join(sandbox, 'workspace')
const output = process.env.SOVEREIGN_CHAT_E2E_OUTPUT || path.join(desktop, 'release/sovereign-chat')
fs.mkdirSync(workspace, { recursive: true })
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(workspace, 'hello.txt'), 'sovereign-packaged-ok\n')

const tags = JSON.parse(execFileSync('curl', ['-s', 'http://127.0.0.1:11434/api/tags'], { encoding: 'utf8' }))
const names = (tags.models || []).map(m => m.name)
if (!names.includes('qwen3.8:27b')) throw new Error(`qwen3.8:27b not in Ollama: ${names}`)

const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
  env: {
    ...process.env,
    HOME: sandbox,
    PATH: '/usr/bin:/bin:/opt/homebrew/bin',
    HERMES_HOME: path.join(sandbox, 'hermes-home'),
    JCODE_HOME: path.join(sandbox, 'jcode-home'),
    SOVEREIGN_PROVIDER: 'ollama',
    SOVEREIGN_MODEL: 'qwen3.8:27b',
    TERMINAL_CWD: workspace,
  }
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('Gateway: ready', { exact: false }).waitFor({ timeout: 180_000 })
  await page.waitForTimeout(3_000)

  // Skip any first-run film / guest chrome if present.
  for (const label of ['Skip', 'Skip intro', 'Get started', 'Continue']) {
    const btn = page.getByRole('button', { name: label })
    if (await btn.count()) await btn.first().click({ timeout: 2_000 }).catch(() => {})
  }

  const composer = page.locator('[aria-label="Message"]').first()
  await composer.waitFor({ timeout: 60_000 })
  await composer.click()
  const prompt = 'Use a shell command to print the contents of hello.txt in the current directory. Do not invent the contents.'
  await page.keyboard.type(prompt, { delay: 5 })
  await page.keyboard.press('Enter')

  const run = page.locator('[data-approval-run]').first()
  await run.waitFor({ timeout: 300_000 })
  await page.screenshot({ path: path.join(output, 'approval.png'), animations: 'disabled' })
  await run.click()

  await page.getByText(/sovereign-packaged-ok/, { timeout: 300_000 }).waitFor()
  await page.screenshot({ path: path.join(output, 'chat-done.png'), animations: 'disabled' })
  const body = await page.locator('body').innerText()
  fs.writeFileSync(path.join(output, 'chat.txt'), body.slice(0, 8000))
  if (!/sovereign-packaged-ok/.test(body)) throw new Error('Tool result not visible after approval')
  console.log(JSON.stringify({ sandbox, output, ok: true }, null, 2))
} finally {
  await app.close()
}

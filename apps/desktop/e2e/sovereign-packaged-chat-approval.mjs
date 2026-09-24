// Packaged-app chat + tool approval against local Ollama.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { assertPackagedHermesExists, sovereignSandboxEnv } from './sovereign-packaged-paths.mjs'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = assertPackagedHermesExists()
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-chat-'))
const workspace = path.join(sandbox, 'workspace')
const outFile = path.join(sandbox, 'approval-out.txt')
const output = process.env.SOVEREIGN_CHAT_E2E_OUTPUT || path.join(desktop, 'release/sovereign-chat')
fs.mkdirSync(workspace, { recursive: true })
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(workspace, 'README.md'), 'sandbox workspace for packaged chat e2e\n')

const tags = JSON.parse(execFileSync('curl', ['-s', 'http://127.0.0.1:11434/api/tags'], { encoding: 'utf8' }))
const names = (tags.models || []).map(m => m.name)
if (!names.includes('qwen3.8:27b')) throw new Error(`qwen3.8:27b not in Ollama: ${names}`)

const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
  env: {
    ...sovereignSandboxEnv(sandbox),
    HERMES_DESKTOP_CWD: workspace,
    TERMINAL_CWD: workspace,
    SOVEREIGN_PROVIDER: 'ollama',
    SOVEREIGN_MODEL: 'qwen3.8:27b',
    SOVEREIGN_OLLAMA_NUM_CTX: '32768',
    HERMES_SKIP_INTRO: '1',
  }
})

const dump = async (page, name) => {
  try {
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' })
    fs.writeFileSync(path.join(output, `${name}.txt`), (await page.locator('body').innerText()).slice(0, 12000))
  } catch (err) {
    fs.writeFileSync(path.join(output, `${name}-dump-error.txt`), String(err))
  }
}

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('ready', { exact: true }).waitFor({ timeout: 180_000 })
  const composer = page.locator('[aria-label="Message"]').first()
  await composer.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(2_000)

  for (const label of ['Skip', 'Skip intro', 'Get started', 'Continue', 'Not now']) {
    const btn = page.getByRole('button', { name: label })
    if (await btn.count()) await btn.first().click({ timeout: 2_000 }).catch(() => {})
  }

  await composer.click()
  // Truncating redirect outside the session cwd is RiskLevel::Low → sovereign
  // pre-tool approval. In-cwd `echo > out.txt` is Safe and never shows a card.
  // One line only: keyboard.type('\\n') submits the composer early.
  const prompt =
    `In the current working directory, run EXACTLY this shell command and nothing else: echo sovereign-packaged-ok > ${outFile}. Then reply with the file contents. Do not invent the contents; use the shell tool.`
  await composer.fill(prompt)
  await page.keyboard.press('Enter')
  await dump(page, 'after-send')

  const run = page.locator('[data-approval-run]').first()
  try {
    await run.waitFor({ timeout: 300_000 })
  } catch (err) {
    await dump(page, 'no-approval')
    const sessions = path.join(sandbox, 'jcode-home/sessions')
    if (fs.existsSync(sessions)) {
      execFileSync('cp', ['-R', sessions, path.join(output, 'sessions')])
    }
    throw err
  }
  await dump(page, 'approval')
  await run.click()

  // Don't match the user prompt or the approval card's command preview.
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8').includes('sovereign-packaged-ok')) {
      break
    }
    await page.waitForTimeout(1_000)
  }
  if (!fs.existsSync(outFile) || !fs.readFileSync(outFile, 'utf8').includes('sovereign-packaged-ok')) {
    await dump(page, 'no-outfile')
    throw new Error(`tool did not write ${outFile} after approval`)
  }
  await page.getByText(/Here is the exact content|exact content of|sovereign-packaged-ok/, { timeout: 120_000 }).first().waitFor().catch(() => {})
  await dump(page, 'chat-done')
  console.log(JSON.stringify({
    sandbox,
    output,
    ok: true,
    outFile,
    contents: fs.readFileSync(outFile, 'utf8').trim(),
  }, null, 2))
} finally {
  await app.close()
}

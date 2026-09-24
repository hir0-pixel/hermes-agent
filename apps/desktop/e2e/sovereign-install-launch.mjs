import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = path.join(desktop, 'release/mac-arm64/Hermes.app/Contents/MacOS/Hermes')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-install-'))
const output = process.env.SOVEREIGN_INSTALL_E2E_OUTPUT || path.join(desktop, 'release/sovereign-install')
fs.mkdirSync(output, { recursive: true })
const tree = root => {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' }).trim().split('\n').slice(1)
    .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map(([, pid, ppid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), comm }))
  const owned = new Set([root])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true }
  }
  return rows.filter(row => owned.has(row.pid))
}
const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
  env: {
    ...process.env,
    HOME: sandbox,
    PATH: '/usr/bin:/bin',
    HERMES_HOME: path.join(sandbox, 'hermes-home'),
    JCODE_HOME: path.join(sandbox, 'jcode-home'),
    SOVEREIGN_FEATURE_IDLE_MS: '1500'
  }
})
try {
  const page = await app.firstWindow()
  const mainPid = app.process().pid
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(10_000)
  console.log('editors', await page.locator('textarea,[contenteditable=true]').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, outer: node.outerHTML.slice(0, 300) }))))
  await page.screenshot({ path: path.join(output, 'first-run.png'), animations: 'disabled' })
  const text = (await page.locator('body').innerText()).slice(0, 3000)
  const processes = tree(mainPid)
  if (processes.filter(row => row.comm.endsWith('/sovereign')).length !== 1) throw new Error('Expected one Sovereign process')
  if (processes.some(row => /python/i.test(row.comm))) throw new Error('Python started before a feature opened')
  fs.writeFileSync(path.join(output, 'first-run.txt'), `${text}\n\n${JSON.stringify(processes, null, 2)}\n`)
  await page.getByText('Scheduled jobs', { exact: true }).click()
  await page.waitForTimeout(5_000)
  const cronProcesses = tree(mainPid)
  await page.screenshot({ path: path.join(output, 'cron.png'), animations: 'disabled' })
  if (!cronProcesses.some(row => /python/i.test(row.comm))) throw new Error('Cron did not start bundled Python')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(5_000)
  const idleProcesses = tree(mainPid)
  if (idleProcesses.some(row => /python/i.test(row.comm))) throw new Error('Python did not stop after idle timeout')
  console.log(JSON.stringify({ sandbox, processes, cronProcesses, idleProcesses }, null, 2))
} finally {
  await app.close()
}

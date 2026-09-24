// Prove packaged quit and hard-kill leave no orphan sovereign/python within 5s.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  assertPackagedHermesExists,
  sovereignSandboxEnv,
} from './sovereign-packaged-paths.mjs'
import {
  isPythonComm,
  isSovereignComm,
  killProcessHard,
  listMatchingProcesses,
  processAlive,
} from './sovereign-process-utils.mjs'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = assertPackagedHermesExists()
const output = process.env.SOVEREIGN_ORPHAN_E2E_OUTPUT || path.join(desktop, 'release/sovereign-orphan')
fs.mkdirSync(output, { recursive: true })

const sovereignHits = () => listMatchingProcesses(isSovereignComm)
const pythonHits = () => listMatchingProcesses(isPythonComm)

const waitClean = async (hits, label) => {
  const samples = []
  const start = Date.now()
  while (Date.now() - start < 5_000) {
    const hit = hits()
    samples.push({ ms: Date.now() - start, hit })
    if (!hit.length) {
      fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(samples, null, 2))
      return
    }
    await new Promise(r => setTimeout(r, 200))
  }
  fs.writeFileSync(path.join(output, `${label}-FAIL.json`), JSON.stringify(samples, null, 2))
  throw new Error(`${label}: orphans remain after 5s: ${JSON.stringify(samples.at(-1))}`)
}

const launch = async tag => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `sovereign-orphan-${tag}-`))
  const app = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
    env: {
      ...sovereignSandboxEnv(sandbox),
      SOVEREIGN_ORPHAN_MARKER: path.basename(sandbox),
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(8_000)
  await page.getByText('Scheduled jobs', { exact: true }).click()
  await page.getByText('0 jobs').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1_000)
  const mainPid = app.process().pid
  const before = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process | Format-Table -AutoSize'], { encoding: 'utf8' })
    : execFileSync('/bin/ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' })
  fs.writeFileSync(path.join(output, `${tag}-before.txt`), before)
  return { app, mainPid, sandbox }
}

{
  const { app, mainPid } = await launch('quit')
  if (!sovereignHits().some(r => isSovereignComm(r.comm))) {
    throw new Error('sovereign not running before quit')
  }
  await app.close()
  await waitClean(sovereignHits, 'quit')
  if (processAlive(mainPid)) {
    throw new Error(`Electron ${mainPid} still alive after close`)
  }
  console.log('quit: clean')
}

{
  const { app, mainPid } = await launch('kill9')
  if (!sovereignHits().some(r => isSovereignComm(r.comm))) {
    throw new Error('sovereign not running before kill')
  }
  killProcessHard(mainPid)
  try {
    await app.close()
  } catch {}
  await waitClean(sovereignHits, 'kill9')
  console.log('kill9: clean')
}

console.log(JSON.stringify({ output, ok: true }, null, 2))

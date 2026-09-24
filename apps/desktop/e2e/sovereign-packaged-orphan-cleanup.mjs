// Prove packaged quit and kill -9 leave no orphan sovereign/python within 5s.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = path.join(desktop, 'release/mac-arm64/Hermes.app/Contents/MacOS/Hermes')
const output = process.env.SOVEREIGN_ORPHAN_E2E_OUTPUT || path.join(desktop, 'release/sovereign-orphan')
fs.mkdirSync(output, { recursive: true })

const listMatching = (marker) => {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' }).trim().split('\n').slice(1)
  return rows
    .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map(([, pid, ppid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), comm }))
    .filter(row => row.comm.includes(marker) && (/\/sovereign$|python/i.test(row.comm)))
}

const waitClean = async (marker, label) => {
  const samples = []
  const start = Date.now()
  while (Date.now() - start < 5_000) {
    const hit = listMatching(marker)
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

const launch = async (tag) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `sovereign-orphan-${tag}-`))
  const marker = path.basename(sandbox)
  const app = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
    env: {
      ...process.env,
      HOME: sandbox,
      PATH: '/usr/bin:/bin',
      HERMES_HOME: path.join(sandbox, 'hermes-home'),
      JCODE_HOME: path.join(sandbox, 'jcode-home'),
      // Unique env crumb so we can find our JCODE_HOME-related processes via ps eww if needed.
      SOVEREIGN_ORPHAN_MARKER: marker,
      SOVEREIGN_FEATURE_IDLE_MS: '1500',
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(8_000)
  // Wake Python so orphan checks cover both processes.
  await page.getByText('Scheduled jobs', { exact: true }).click()
  await page.getByText('0 jobs').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1_000)
  const mainPid = app.process().pid
  const before = execFileSync('/bin/ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' })
  fs.writeFileSync(path.join(output, `${tag}-before.txt`), before)
  return { app, mainPid, sandbox, marker }
}

// 1) Normal quit
{
  const { app, mainPid, marker } = await launch('quit')
  const sovereignBefore = listMatching('Resources/sovereign')
  if (!sovereignBefore.some(r => r.comm.endsWith('/sovereign'))) throw new Error('sovereign not running before quit')
  await app.close()
  await waitClean('Resources/sovereign', 'quit')
  // Also ensure this Electron pid is gone.
  try { process.kill(mainPid, 0); throw new Error(`Electron ${mainPid} still alive after close`) } catch (e) {
    if (e.code !== 'ESRCH' && !String(e.message).includes('ESRCH')) {
      if (e.message?.includes('still alive')) throw e
    }
  }
  console.log('quit: clean')
}

// 2) kill -9 Electron main
{
  const { app, mainPid } = await launch('kill9')
  if (!listMatching('Resources/sovereign').some(r => r.comm.endsWith('/sovereign'))) throw new Error('sovereign not running before kill -9')
  execFileSync('/bin/kill', ['-9', String(mainPid)])
  // Playwright may error on the dead process; ignore.
  try { await app.close() } catch {}
  await waitClean('Resources/sovereign', 'kill9')
  console.log('kill9: clean')
}

console.log(JSON.stringify({ output, ok: true }, null, 2))

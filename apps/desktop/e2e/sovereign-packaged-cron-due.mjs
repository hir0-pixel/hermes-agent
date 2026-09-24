// Prove idle-stopped Python still fires a due cron job via engine wake-before-due.
import { _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { assertPackagedHermesExists, sovereignSandboxEnv } from './sovereign-packaged-paths.mjs'
import { isPythonComm, isSovereignComm, processTree } from './sovereign-process-utils.mjs'

const desktop = path.resolve(import.meta.dirname, '..')
const executablePath = assertPackagedHermesExists()
if (process.platform === 'win32') {
  throw new Error('sovereign-packaged-cron-due is Unix-only (shell cron probe); skip on Windows CI')
}
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-cron-due-'))
const hermesHome = path.join(sandbox, 'hermes-home')
const output = process.env.SOVEREIGN_CRON_DUE_E2E_OUTPUT || path.join(desktop, 'release/sovereign-cron-due')
fs.mkdirSync(output, { recursive: true })
fs.mkdirSync(path.join(hermesHome, 'scripts'), { recursive: true })
fs.mkdirSync(path.join(hermesHome, 'cron'), { recursive: true })

const marker = path.join(hermesHome, 'cron-fired.txt')
const scriptRel = 'sovereign_due_probe.sh'
fs.writeFileSync(
  path.join(hermesHome, 'scripts', scriptRel),
  `#!/bin/sh\nprintf 'fired-at=%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > '${marker}'\necho sovereign-cron-due-ok\n`,
  { mode: 0o755 }
)

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
const hasPython = procs => procs.some(row => /python/i.test(row.comm))
const readJobs = () => {
  const p = path.join(hermesHome, 'cron', 'jobs.json')
  if (!fs.existsSync(p)) return []
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  return Array.isArray(raw) ? raw : (raw.jobs || [])
}

const dueMinutes = Number(process.env.SOVEREIGN_CRON_DUE_MINUTES || 2)
const wakeLeadMs = Number(process.env.SOVEREIGN_CRON_WAKE_LEAD_MS || 30_000)
const idleMs = Number(process.env.SOVEREIGN_FEATURE_IDLE_MS || 1500)

const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(sandbox, 'user-data')}`],
  env: {
    ...process.env,
    HOME: sandbox,
    PATH: '/usr/bin:/bin:/opt/homebrew/bin',
    HERMES_HOME: hermesHome,
    JCODE_HOME: path.join(sandbox, 'jcode-home'),
    SOVEREIGN_FEATURE_IDLE_MS: String(idleMs),
    SOVEREIGN_CRON_WAKE_LEAD_MS: String(wakeLeadMs),
    SOVEREIGN_CRON_HOLD_CAP_MS: '180000',
  }
})

const log = []
const note = (msg, extra) => {
  const row = { t: new Date().toISOString(), msg, ...extra }
  log.push(row)
  console.log(JSON.stringify(row))
}

try {
  const page = await app.firstWindow()
  const mainPid = app.process().pid
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(8_000)
  note('ready', { python: hasPython(tree(mainPid)) })

  // Open Cron once so we know the feature backend path works, then close it.
  await page.getByText('Scheduled jobs', { exact: true }).click()
  await page.getByText('0 jobs').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(2_000)
  if (!hasPython(tree(mainPid))) throw new Error('Python did not start for Cron')

  const dueAt = new Date(Date.now() + dueMinutes * 60_000).toISOString()
  const job = {
    id: 'sovdueprobe01',
    name: 'sovereign-due-probe',
    prompt: '',
    script: scriptRel,
    no_agent: true,
    schedule: { kind: 'once', run_at: dueAt, display: `once at ${dueAt}` },
    schedule_display: `once at ${dueAt}`,
    repeat: { times: 1, completed: 0 },
    enabled: true,
    state: 'scheduled',
    next_run_at: dueAt,
    created_at: new Date().toISOString(),
    deliver: 'local',
  }
  fs.writeFileSync(path.join(hermesHome, 'cron', 'jobs.json'), JSON.stringify([job], null, 2))
  note('wrote-job', { dueAt, job })

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(idleMs + 4_000)
  const afterClose = tree(mainPid)
  note('after-close', {
    python: hasPython(afterClose),
    procs: afterClose.filter(r => /sovereign|python/i.test(r.comm)).map(r => r.comm.split('/').pop()),
    ms_to_due: Date.parse(dueAt) - Date.now(),
  })
  if (hasPython(afterClose)) throw new Error('Python still running after Cron closed; idle stop failed before due window')

  const wakeAt = Date.parse(dueAt) - wakeLeadMs
  while (Date.now() < wakeAt - 1_000) await page.waitForTimeout(2_000)
  let woke = false
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1_000)
    if (hasPython(tree(mainPid))) { woke = true; break }
  }
  note('wake', { woke, python: hasPython(tree(mainPid)), ms_to_due: Date.parse(dueAt) - Date.now() })
  if (!woke) throw new Error('Engine did not wake Python before due time')

  const deadline = Date.parse(dueAt) + 120_000
  while (Date.now() < deadline) {
    if (fs.existsSync(marker)) break
    await page.waitForTimeout(2_000)
  }
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(path.join(output, 'jobs-after-timeout.json'), fs.readFileSync(path.join(hermesHome, 'cron', 'jobs.json')))
    // Also dump any cron output dir
    const outDir = path.join(hermesHome, 'cron', 'output')
    if (fs.existsSync(outDir)) {
      fs.writeFileSync(path.join(output, 'cron-output-listing.txt'), execFileSync('ls', ['-laR', outDir], { encoding: 'utf8' }))
    }
    throw new Error('Cron job did not fire (marker missing)')
  }
  const fired = fs.readFileSync(marker, 'utf8')
  note('fired', { fired: fired.trim(), jobs: JSON.stringify(readJobs()).slice(0, 1500) })

  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(2_000)
    if (!hasPython(tree(mainPid))) break
  }
  const finalProcs = tree(mainPid)
  note('final', { python: hasPython(finalProcs), jobs: readJobs() })
  fs.writeFileSync(path.join(output, 'log.json'), JSON.stringify(log, null, 2))
  fs.writeFileSync(path.join(output, 'marker.txt'), fired)
  if (hasPython(finalProcs)) throw new Error('Python did not stop again after job finished')
  console.log(JSON.stringify({ ok: true, sandbox, output }, null, 2))
} finally {
  await app.close()
}

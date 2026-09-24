// Packaged sovereign binary: API-key first-run storage (0600 file, never logged in full).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const sovereign = path.join(desktop, 'release/mac-arm64/Hermes.app/Contents/Resources/sovereign/sovereign')
const output = process.env.SOVEREIGN_APIKEY_E2E_OUTPUT || path.join(desktop, 'release/sovereign-apikey')
fs.mkdirSync(output, { recursive: true })
if (!fs.existsSync(sovereign)) throw new Error(`missing packaged sovereign: ${sovereign}`)

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-apikey-'))
const jcodeHome = path.join(sandbox, 'jcode-home')
const key = 'sk-test-sovereign-packaged-never-log-this-key-9f3a'
const loginOut = path.join(output, 'login.stdout.txt')

const result = spawnSync(sovereign, ['login', 'openai-api'], {
  env: { ...process.env, JCODE_HOME: jcodeHome, HOME: sandbox, XDG_CONFIG_HOME: path.join(sandbox, 'xdg') },
  input: `${key}\n`,
  encoding: 'utf8',
  timeout: 120_000,
})
fs.writeFileSync(loginOut, `${result.stdout || ''}\n---stderr---\n${result.stderr || ''}\n---status ${result.status}\n`)

const envFile = path.join(jcodeHome, 'config/jcode/openai.env')
if (!fs.existsSync(envFile)) throw new Error(`API key file missing: ${envFile}\n${fs.readFileSync(loginOut, 'utf8')}`)
const mode = (fs.statSync(envFile).mode & 0o777).toString(8)
if (mode !== '600') throw new Error(`expected 0600, got ${mode}`)
const stored = fs.readFileSync(envFile, 'utf8')
if (!stored.includes(key)) throw new Error('key not stored in openai.env')

const combined = `${result.stdout || ''}\n${result.stderr || ''}`
if (combined.includes(key)) throw new Error('full API key appeared in login stdout/stderr')
// OpenAI error responses may mask as sk-test-***9f3a — that is fine.
const logsDir = path.join(jcodeHome, 'logs')
if (fs.existsSync(logsDir)) {
  for (const name of fs.readdirSync(logsDir)) {
    const text = fs.readFileSync(path.join(logsDir, name), 'utf8')
    if (text.includes(key)) throw new Error(`full API key logged in ${name}`)
  }
}

fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
  ok: true,
  envFile,
  mode,
  sandbox,
  loginStatus: result.status,
  stdoutHasFullKey: false,
}, null, 2))
console.log(JSON.stringify({ ok: true, envFile, mode }, null, 2))

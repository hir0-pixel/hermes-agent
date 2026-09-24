// Build-time only: make forwarded Hermes features work without a user Python install.
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '../../..')
const stage = path.resolve(import.meta.dirname, '../build/sovereign-python')
const managed = path.resolve(import.meta.dirname, '../build/sovereign-python-managed')
const version = '3.12.12'
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Python staging currently supports macOS arm64 only')

const runtime = process.env.SOVEREIGN_PYTHON_RUNTIME || path.join(managed, `cpython-${version}-macos-aarch64-none`)
const packages = process.env.SOVEREIGN_PYTHON_PACKAGES || path.join(stage, 'packages')
if (!process.env.SOVEREIGN_PYTHON_RUNTIME) {
  execFileSync('uv', ['python', 'install', version, '--install-dir', managed], { stdio: 'inherit' })
}
if (!existsSync(path.join(runtime, 'bin/python3.12'))) throw new Error(`Python runtime missing: ${runtime}`)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(runtime, path.join(stage, 'runtime'), { recursive: true })
if (process.env.SOVEREIGN_PYTHON_PACKAGES) {
  cpSync(packages, path.join(stage, 'packages'), { recursive: true })
} else {
  execFileSync('uv', ['pip', 'install', '--target', path.join(stage, 'packages'), '--python', path.join(stage, 'runtime/bin/python3.12'), '--requirements', path.join(repo, 'pyproject.toml')], { cwd: repo, stdio: 'inherit' })
}

const source = path.join(stage, 'source')
mkdirSync(source)
const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: repo, maxBuffer: 256 * 1024 * 1024 })
const extracted = spawnSync('tar', ['-xf', '-', '-C', source], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
if (extracted.status !== 0) throw new Error('Could not stage Hermes source')
const defaults = execFileSync(path.join(stage, 'runtime/bin/python3.12'), [
  '-c', 'import json; from hermes_cli.config_defaults import DEFAULT_CONFIG; print(json.dumps(DEFAULT_CONFIG))'
], { env: { ...process.env, PYTHONPATH: [source, path.join(stage, 'packages')].join(path.delimiter) } })
writeFileSync(path.join(stage, 'defaults.json'), defaults)
const tools = path.join(stage, 'tools')
mkdirSync(tools)
copyFileSync(realpathSync(execFileSync('which', ['uv'], { encoding: 'utf8' }).trim()), path.join(tools, 'uv'))
console.log(`Staged Hermes Python runtime at ${stage}`)

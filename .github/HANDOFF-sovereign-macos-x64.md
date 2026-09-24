# Sovereign Hermes — macOS x64 packaging handoff

## Goal

Ship `release/mac/Hermes.app` (electron-builder x64 output) with a matching **x86_64** `sovereign` binary and **x86_64** bundled Python, then run the same packaged smoke scripts as arm64.

## What CI does today

Workflow: [sovereign-macos-x64.yml](./workflows/sovereign-macos-x64.yml)

- **Primary path:** `runs-on: macos-13` (Intel runner). Native `cargo build --release --bin sovereign`, `npm run stage:sovereign-python` on `darwin-x64`, then `npm run builder -- --mac zip --x64`.
- **Artifact:** `Hermes-macos-x64-zip` (unsigned zip). Smoke steps reuse `apps/desktop/e2e/sovereign-*.mjs` with `SOVEREIGN_PACKAGED_ROOT` pointing at `release/mac`.

## Blockers on Apple Silicon (macos-latest)

Cross-packaging **darwin-x64** from an arm64 host is not fully automated yet:

| Piece | arm64 CI status |
| --- | --- |
| `sovereign` for `x86_64-apple-darwin` | Possible with `rustup target add x86_64-apple-darwin` + `cargo build --target x86_64-apple-darwin` (set `SOVEREIGN_BIN` to that path). |
| Bundled CPython 3.12 x86_64 | `uv python install` on Apple Silicon currently surfaces **aarch64** macOS runtimes only; `cpython-*-macos-x86_64-none` is not listed. `before-pack.mjs` runs `lipo -archs` and will reject an arm64-only Python when packing `--x64`. |
| node-pty / get-windows prebuilds | electron-builder re-stages per target arch in `before-pack.mjs`; x64 prebuilds must exist for the host that runs the pack step. |

**Conclusion:** Reliable x64 bundles still need an **Intel macOS runner** (`macos-13`) or a **physical x64 Mac** for local pack + smoke. arm64 CI can build the engine slice via cross-compile but cannot complete the desktop bundle without x86_64 Python.

## Local x64 pack (Intel Mac)

```bash
cd sovereign-engine && cargo build --release --bin sovereign
export SOVEREIGN_ENGINE_ROOT="$PWD"
cd ../hermes-agent/apps/desktop
npm ci
npm run stage:sovereign-python   # host must be darwin-x64
npm run builder -- --mac zip --x64
export SOVEREIGN_PACKAGED_ROOT="$PWD/release/mac"
node e2e/sovereign-install-launch.mjs
```

## Still needs a real x64 Mac

- Gatekeeper / notarization UX for unsigned x64 zip (CI skips notarization).
- Ollama chat smoke (`sovereign-packaged-chat-approval.mjs`) — optional; needs local Ollama + model pull.
- Cron due probe (`sovereign-packaged-cron-due.mjs`) — Unix shell script; not run on Windows CI.

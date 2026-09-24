# Install Sovereign (Hermes Desktop + bundled engine)

One installer. No developer tools required. Unsigned builds for local testing.

## macOS (Apple Silicon)

1. Open `Hermes-*-mac-arm64.dmg` (or unzip the `.zip`).
2. Drag **Hermes** into Applications (DMG) or open the app from the unzipped folder.
3. First launch: right-click → **Open** if Gatekeeper blocks an unsigned build.
4. Optional local model: install [Ollama](https://ollama.com), then `ollama pull qwen3.8:27b`. Sovereign warms it at 32k context and unloads it when you quit the app.
5. Or paste an API key when prompted (stored under the app’s config with mode `600`).

### What stays quiet until you need it

- **Python** (Cron, Messaging, Skills, …) starts only when you open those features, then stops after idle.
- **Scheduled jobs** still fire after idle: the engine wakes Python shortly before a due job, then idle-stops again.
- **Ollama** stays loaded while Hermes is open (`keep_alive` until quit), then is unloaded on exit.

## Windows (x64)

1. Run `Hermes-*-win-x64.exe` (NSIS, unsigned).
2. Finish the installer and launch **Hermes**.
3. Same Ollama / API-key options as macOS.

CI builds the Windows installer on every packaging push:  
https://github.com/hir0-pixel/hermes-agent/actions/workflows/sovereign-windows-nsis.yml

## Verify after install

| Check | Expect |
| --- | --- |
| Launch chat only | No `python` / `python.exe` child until you open **Scheduled jobs** (or another Hermes feature) |
| Open Scheduled jobs | Bundled Python starts; close the panel and wait ~idle timeout → Python stops |
| Quit the app | `ollama ps` no longer lists the Sovereign warm alias |

## Efficiency numbers

See [`sovereign-engine/docs/BENCHMARK.md`](../sovereign-engine/docs/BENCHMARK.md) for Ollama RSS at 16k vs 32k, tool-schema prefix size, and a counting-proxy comparison vs stock Hermes.

## Build from source (developers)

```bash
# Engine
cd sovereign-engine && cargo build --release --bin sovereign

# Desktop (mac arm64 example)
cd hermes-agent/apps/desktop
SOVEREIGN_ENGINE_ROOT=../../sovereign-engine npm run stage:sovereign-python
SOVEREIGN_ENGINE_ROOT=../../sovereign-engine npm run dist   # or dist:win:nsis on Windows
```

Artifacts land in `apps/desktop/release/`.

# dsh-sight

Plug-in vision for text-only [DeepSeek Harness (dsh)](https://deepseek.com/harness) models — paste an image, get a text description through a built-in VLM backend, no model switching.

[中文版 → README.zh-CN.md](README.zh-CN.md)

## Features

- **Built-in VLM presets** — OpenCode Zen (free, keyless) and Gemini Flash (free tier). Pick one in the web settings page, done.
- **Multi-image batch** — the `vision` tool takes up to 10 paths/URLs and describes all of them in ONE request, labeled per image.

## How it works

1. **Prompt-admission override** — dsh refuses image pastes for text-only models. dsh-sight wraps `apiProxy.sessions.prompt`: the paste is accepted, the bytes land in `/tmp/dsh-sight/image{N}/{hash}.png`, and the image block becomes a path hint before entering history. Works with any provider — no model variant to switch.
2. **`vision` tool** — the model calls it with the hint path (or any local path / http(s) URL); the plugin reads the bytes and answers through the configured OpenAI-compatible VLM backend.
3. **System-prompt section** — teaches the model the hint → `vision` tool flow.
4. **Web settings page** (Settings → Vision) — preset dropdown, API-key field, advanced overrides. Saved through the standard settings RPC and applied live, no restart (hot-reload via the `dsh-sight:` section of `$DSH_HOME/settings.yaml`).

## Install

**Via your AI agent** (recommended) — copy this to your agent:

```
Install dsh-sight for me: https://raw.githubusercontent.com/Fu3rte/dsh-sight/master/install.md
```

Or manually:

```sh
dsh plugin --profile web add github:Fu3rte/dsh-sight
```

(or `dsh plugin --profile web add dsh-sight` once published to npm)

## Configure

Open dsh web → **Settings → Vision**:

1. Pick a preset (model / base URL fill themselves).
2. Paste the API key if one is needed, hit Save — applied immediately.

| Preset | Provider | Key env | Price |
|---|---|---|---|
| `opencode-zen` | OpenCode Zen | _(keyless)_ | free tier |
| `gemini-flash` | Google AI Studio (OpenAI-compat) | `GEMINI_API_KEY` | free tier |

The keyless preset needs nothing but the save button. Any other OpenAI-compatible endpoint works too: set model / baseUrl in the advanced section.

### Headless / no-GUI fallback

Config layers (highest wins):

1. `settings.yaml` `dsh-sight:` section (hot-reloads on edit)
2. `DSH_SIGHT_*` env vars (`DSH_SIGHT_PROVIDER`, `DSH_SIGHT_API_KEY`, `DSH_SIGHT_MODEL`, `DSH_SIGHT_BASE_URL`, `DSH_SIGHT_TIMEOUT_MS`, `DSH_SIGHT_MAX_TOKENS`, `DSH_SIGHT_MAX_IMAGES`, `DSH_SIGHT_CONFIG`)
3. `~/.config/dsh-sight/config.json` (re-read on mtime change)
4. plugin row config in the profile's `cordis.patch.yml`
5. preset defaults

The API key is `role('secret')`: it never rides a settings response; the UI renders a write-only field and reports whether one is stored.

## Multi-image batch

The `vision` tool's `paths` array takes up to 10 images per call (local paths or URLs, 25 MiB each). One request, per-image labels:

```
--- Image 1 ---
<description>
--- Image 2 ---
<description>
```

## Development

```sh
pnpm install                 # plugin-local deps (schemastery, dsh-settings)
node test/engine-smoke.mjs   # engine: batch, keyless, extension guard
node test/plugin-apply.mjs   # registrations: tool, admission override, settings wiring
dsh plugin --profile test add ./   # local install
dsh --profile test --dump-config   # verify the layer
```

## Acknowledgements

Inspired by the vision-helper pattern from [opencode](https://github.com/anomalyco/opencode), [modlens](https://github.com/liustack/modlens), and [dsh-eyes](https://github.com/JY626/dsh-eyes).

DeepSeek Harness: [official site](https://deepseek.com/harness) · [GitHub](https://github.com/deepseek-ai/deepseek-harness)

License: MIT

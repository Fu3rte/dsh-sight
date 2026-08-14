# dsh-sight

Plug-in vision for text-only [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) models. A dsh port of the opencode `vision-helper` pattern, with two upgrades:

- **Built-in VLM presets** — GLM-4V-Flash (free), Gemini Flash (free tier), OpenCode Zen (free, keyless), MiMo-V2.5, GPT-4o-mini, and more. Pick one in the web settings page, fill a key, done.
- **Multi-image batch** — the `vision` tool takes N paths/URLs and describes all of them in a single request, labeled per image.

## How it works

1. **Prompt-admission override** — dsh's DeepSeek adapter refuses image pastes at intake (text-only). dsh-sight wraps `apiProxy.sessions.prompt`: a paste for a text-only model is accepted, the image lands in `/tmp/dsh-sight/image{N}/{hash}.png`, and the image block becomes a path hint before the message enters history. Works with ANY provider — no model variant to switch.
2. **`vision` tool** — the model calls it with the hint path (or any local path / http(s) URL); the plugin reads the bytes and answers through the configured VLM backend (OpenAI-compatible or MiniMax native).
3. **System-prompt section** — teaches the model the hint → `vision` tool flow.
4. **Web settings page** (Settings → 视觉模型) — preset dropdown, API-key field, advanced overrides. Saved through the standard settings RPC; applied **live, no restart** (hot-reload via the `dsh-sight:` section of `$DSH_HOME/settings.yaml`).

No build step, no runtime dependencies beyond two dsh packages — plain ESM, so `dsh plugin add github:…` works without pnpm build permissions.

## Install

```sh
dsh plugin --profile web add github:fu3rte/dsh-sight
```

(or publish to npm and `dsh plugin --profile web add dsh-sight`)

## Configure

Open dsh web → **Settings → 视觉模型**:

1. Pick a preset from the dropdown (model / base URL / API type fill themselves).
2. Paste the API key, hit 保存 — applied immediately.

| Preset | Provider | Key env | Price |
|---|---|---|---|
| `opencode-zen` | OpenCode Zen | _(keyless)_ | free tier |
| `gemini-flash` | Google AI Studio (OpenAI-compat) | `GEMINI_API_KEY` | free tier |

The keyless preset needs nothing but the save button. Gemini Flash is free-tier with a signup key; the preset saves you from finding the right baseUrl + model id + API dialect. Any other OpenAI-compatible or MiniMax endpoint still works: set model / baseUrl / API type in the advanced section.

### Headless / no-GUI fallback

The same config works without the web UI. Layers (highest wins):

1. `settings.yaml` `dsh-sight:` section (hot-reloads on edit)
2. `DSH_SIGHT_*` env vars (`DSH_SIGHT_PROVIDER`, `DSH_SIGHT_API_KEY`, `DSH_SIGHT_MODEL`, `DSH_SIGHT_BASE_URL`, `DSH_SIGHT_API_TYPE`, `DSH_SIGHT_TIMEOUT_MS`, `DSH_SIGHT_MAX_TOKENS`, `DSH_SIGHT_MAX_IMAGES`, `DSH_SIGHT_CONFIG`)
3. `~/.config/dsh-sight/config.json` (re-read on mtime change)
4. plugin row config in the profile's `cordis.patch.yml`
5. preset defaults

The API key is `role('secret')`: it never rides a settings response; the UI renders a write-only field and reports whether one is stored.

### Multi-image batch

The `vision` tool's `paths` array takes up to 10 images per call (local paths or URLs, 25 MiB each). One request, per-image labels:

```
--- Image 1 ---
<description>
--- Image 2 ---
<description>
```

(MiniMax's native VLM endpoint is single-image; the plugin runs it with bounded concurrency and joins with the same labels.)

## Comparison with modlens

| | modlens | dsh-sight |
|---|---|---|
| Engine | bundled CLI (own release cadence) | inline in the plugin |
| Output | structured 5-part evidence schema | plain descriptions (+ batch labels) |
| Models | antigravity-cli / gemini / openai / anthropic / claude-cli | presets incl. GLM-4V-Flash, Zen free tier, MiMo-V2.5 |
| Multi-image | one per call | batch up to 10 in one request |
| Paste intake | client.js paste-to-path + provider wrapper | prompt-admission override (any provider, no variant) |
| Config | `~/.modlens/config.json` | web settings page + settings.yaml + env/file fallbacks |

## Development

```sh
pnpm install                 # plugin-local deps (schemastery, dsh-settings)
node test/engine-smoke.mjs   # engine: batch, keyless, minimax concurrency
node test/plugin-apply.mjs   # registrations: tool, admission override, settings wiring
dsh plugin --profile test add ./   # local install
dsh --profile test --dump-config   # verify the layer
```

License: MIT
